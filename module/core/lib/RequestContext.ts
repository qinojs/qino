import { AsyncLocalStorage } from "node:async_hooks";
import type { Item, ItemProxy } from "../../../deps.ts";
import { HtmlBuilder } from "./HtmlBuilder.ts";
import { RequestDeadline } from "./RequestDeadline.ts";
import { Csp } from "./Csp.ts";
import { uid, clientIp, Output } from "./util.ts";
import * as nodePath from "node:path";
import { userSettingsItem, sessSettingsItem } from "./contextSettings.ts";
import { readUploadFile, type UploadedFile } from "./fileStream.ts";
import type { App } from "./App.ts";
import type { dbEntry_client, dbEntry_usr } from "./qgEntries.ts";
import type { Req } from "./Req.ts";
import type { Session } from "./SessionManager.ts";
import type { LoginError } from "./auth.ts";

export class RequestContext {
  app!: App;
  sess: Session = null!;
  cookie: Record<string, string> = {};
  get: Record<string, string> = {};
  post: Record<string, unknown> = {};
  files: Record<string, UploadedFile> = {};
  requestUri = "/";
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

  get userId(): number {
    return Number(this.sess.data.liveUser() || 0);
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
  get token(): string {
    const token = this.sess.data.qg.token;
    if (!token()) this.sess.data.qg.token(uid(11));
    return token() as string;
  }

  urlToLocalPath(url: string): string | null {
    return urlToLocalPath(url, this.appURL, this.app);
  }

  async cleanup(): Promise<void> {
    this.#deadline?.clear();
    for (const f of Object.values(this.files)) {
      const p = (f as { tmpPath?: unknown })?.tmpPath;
      if (typeof p === "string") await Deno.remove(p).catch(() => {});
    }
  }

  static async create(app: App, req: Req, basePath: string): Promise<RequestContext> {
    const appURL = basePath.endsWith("/") ? basePath : basePath + "/";
    const url = new URL(req.url);

    const ct = req.header("content-type") ?? "";
    const isJson = ct.includes("application/json") || ct.includes("application/csp-report");

    const maxSize = Number(await app.settings.core.uploadMaxFileSize ?? "") || 100 * 1024 * 1024;
    if (Number(req.header("content-length") ?? "0") > maxSize) throw new Output("Payload Too Large", { status: 413 });

    const rawBody: unknown = req.method === "POST" ? (isJson ? await req.json() : await req.parseBody()) : {};
    const post: Record<string, unknown> = Object.create(null);
    const files: Record<string, UploadedFile> = Object.create(null);

    for (const [key, val] of Object.entries(rawBody && typeof rawBody === "object" ? rawBody as Record<string, unknown> : {})) {
      if (val instanceof File) {
        files[key] = await readUploadFile(val, { maxSize });
      } else {
        post[key] = val;
      }
    }

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
    ctx.get = req.query();
    ctx.post = post;
    ctx.files = files;
    ctx.requestUri = url.pathname + url.search;
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
