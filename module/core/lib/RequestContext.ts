import { AsyncLocalStorage } from "node:async_hooks";
import type { Item, ItemProxy } from "../../../deps.ts";
import { HtmlBuilder } from "./HtmlBuilder.ts";
import { RequestDeadline } from "./RequestDeadline.ts";
import { Csp } from "./Csp.ts";
import { uid, clientIp, Output } from "./util.ts";
import * as nodePath from "node:path";
import { userSettingsItem, sessSettingsItem } from "./contextSettings.ts";
import type { UploadedFile } from "./fileStream.ts";
import { Body } from "./Body.ts";
import type { App } from "./App.ts";
import type { dbEntry_client, dbEntry_usr } from "./qgEntries.ts";
import type { Req } from "./Req.ts";
import type { Session } from "./SessionManager.ts";
import type { LoginError } from "./auth.ts";

export class RequestContext {
  app!: App;
  sess: Session = null!;
  cookie: Record<string, string> = {};
  get: Readonly<Record<string, string>> = {};
  #body: Body = new Body();
  /** parsed body: null (no body), flat record (form) or deep JSON value */
  // deno-lint-ignore no-explicit-any
  get post(): any { return this.#body.post; }
  /** lazy per-file upload access: `await ctx.files.name` spools that file to tmp */
  get files(): Record<string, Promise<UploadedFile> | undefined> { return this.#body.files; }
  remoteAddr = "";
  responseHeaders: Headers = new Headers();
  responseStatus = 200;
  responseBody: BodyInit | undefined = "";
  // deno-lint-ignore no-explicit-any
  state: Record<string, any> = {};
  lang = "en";
  langUsr = "en";
  langNsPath: string[] = [];
  langNs = "";
  req!: Req;
  clientId: string | null = null;
  logId: Promise<string | null> = Promise.resolve(null);
  loginError?: LoginError;
  appURL = "/";
  sysURL = "/m/";
  appRequestPath = "";
  csp: Csp = new Csp();

  /** Time limit + abort signal of this request: `ctx.deadline.left += 60`, `ctx.deadline.signal`. */
  #deadline: RequestDeadline | null = null;
  get deadline(): RequestDeadline { return this.#deadline ??= new RequestDeadline(this); }

  #html: HtmlBuilder | null = null;
  get html(): HtmlBuilder { return this.#html ??= new HtmlBuilder(); }
  get hasHtml(): boolean { return this.#html !== null; }

  #settingsRoot: Item | null = null;
  get settings(): ItemProxy {
    if (!this.#settingsRoot) throw new Error("ctx.settings not initialized - call ctx.initSettings() first");
    return this.#settingsRoot.proxy;
  }
  async initSettings(): Promise<void> {
    this.#settingsRoot = this.user
      ? await userSettingsItem(this.user, this.app.ctxSettingsSchema)
      : await sessSettingsItem(this.app.db, this.sess.id, this.app.ctxSettingsSchema);
  }

  get url(): URL { return new URL(this.req.url); }

  #authUserId = 0;
  /** Establish request-scoped identity without any session/cookie side effect. */
  authenticate(userId: number): void {
    this.#authUserId = userId;
  }
  /** True when a non-cookie credential (API key, …) identifies this request. */
  get statelessAuth(): boolean { return this.#authUserId !== 0; }

  get userId(): number {
    return this.#authUserId || Number(this.sess.data.core.userId() || 0);
  }
  get user(): dbEntry_usr | null {
    return this.userId ? this.app.db.table('usr').entry(this.userId) as dbEntry_usr : null;
  }
  get client(): dbEntry_client {
    if (!this.clientId) throw new Error("No client id");
    return this.app.db.table('client').entry(this.clientId) as dbEntry_client;
  }

  get dev(): boolean {
    return this.app.dev || !!this.settings.core.dev(); // todo: ctx.settings can be written to, so this may be a security risk.
  }
  /** CSRF/form token, not the session cookie token (`ctx.sess.token`). */
  get csrfToken(): string {
    const token = this.sess.data.core.csrfToken;
    if (!token()) this.sess.data.core.csrfToken(uid(11));
    return token() as string;
  }

  urlToLocalPath(url: string): string | null {
    return urlToLocalPath(url, this.appURL, this.app);
  }

  async cleanup(): Promise<void> {
    this.#deadline?.clear();
    for (const p of await this.#body.settle()) await Deno.remove(p).catch(() => {});
  }

  static async create(app: App, req: Req, basePath: string): Promise<RequestContext> {
    const appURL = basePath.endsWith("/") ? basePath : basePath + "/";

    const maxSize = Number(await app.settings.core.uploadMaxFileSize ?? "") || 100 * 1024 * 1024;
    const body = await Body.parse(req, { maxSize });

    let appRequestPath: string;
    try { appRequestPath = decodeURIComponent(req.path.slice(appURL.length)); }
    catch { throw new Output("Bad Request", { status: 400 }); }

    const ctx = new RequestContext();
    ctx.req = req;
    ctx.app = app;
    ctx.appURL = appURL;
    ctx.sysURL = appURL + "m/";
    ctx.appRequestPath = appRequestPath;
    ctx.sess = await app.sessions.loadFromRequest(req, app.https, appURL);
    ctx.cookie = req.cookies();
    ctx.get = Object.freeze(req.query());
    ctx.#body = body;
    ctx.remoteAddr = clientIp(req, app.trustedProxyHops);
    return ctx;
  }
}

/** Resolve a request URL to a servable local file (module/qg pub dirs); null if it is no static path. */
export function urlToLocalPath(url: string, appURL: string, app: App): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return u.pathname;
    const appRequestPath = decodeURIComponent(u.pathname.slice(appURL.length));
    return appRequestPathToLocalPath(appRequestPath, app);
  } catch { /* not a URL */ }
  return null;
}

function appRequestPathToLocalPath(appRequestPath: string, app: App): string | null {
  const matchM = appRequestPath.match(/^m\/([^/]+)\/pub\/(.*)/);
  if (matchM) {
    const mod = app.modules.get(matchM[1]);
    const base = mod?.dir ?? (app.appPATH + "m/" + matchM[1] + "/");
    return pubPath(base, matchM[2]);
  }
  const matchQg = appRequestPath.match(/^qg\/([^/]+)\/pub\/(.*)/);
  return matchQg ? pubPath(app.appPATH + "qg/" + matchQg[1] + "/", matchQg[2]) : null;
}

function pubPath(root: string, file: string): string | null {
  if (!file || file.includes("\0")) return null;
  const pub = nodePath.resolve(root, "pub"), target = nodePath.resolve(pub, file);
  const rel = nodePath.relative(pub, target);
  return rel && rel !== ".." && !rel.startsWith(".." + nodePath.sep) ? target : null;
}

export const requestStorage: AsyncLocalStorage<RequestContext> = new AsyncLocalStorage();

export function getCtx(): RequestContext {
  const ctx = requestStorage.getStore();
  if (!ctx) throw new Error("getCtx() called outside of request context");
  return ctx;
}
