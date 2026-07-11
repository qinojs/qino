import { AsyncLocalStorage } from "node:async_hooks";
import type { Item, ItemProxy } from "../../../../deps.ts";
import { HtmlBuilder } from "./HtmlBuilder.ts";
import type { RequestDeadline } from "./RequestDeadline.ts";
import { Csp } from "./Csp.ts";
import { uid } from "../util.ts";
import * as nodePath from "node:path";
import { userSettingsItem, sessSettingsItem } from "./contextSettings.ts";
import type { UploadedFile } from "../fileStream.ts";
import { ContextRequest } from "./ContextRequest.ts";
import type { App } from "../App.ts";
import type { dbEntry_client, dbEntry_usr } from "../qgEntries.ts";
import type { Session } from "../SessionManager.ts";
import type { LoginError } from "../auth.ts";

export class RequestContext {
  app!: App;
  req!: ContextRequest;
  sess: Session = null!;
  clientId: string | null = null;
  logId: Promise<string | null> = Promise.resolve(null);
  loginError?: LoginError;
  // deno-lint-ignore no-explicit-any
  state: Record<string, any> = {};
  lang = "en";
  langUsr = "en";
  langNsPath: string[] = [];
  langNs = "";

  responseHeaders: Headers = new Headers();
  responseStatus = 200;
  responseBody: BodyInit | undefined = "";
  csp: Csp = new Csp();

  #html: HtmlBuilder | null = null;
  get html(): HtmlBuilder { return this.#html ??= new HtmlBuilder(); }
  get hasHtml(): boolean { return this.#html !== null; }

  /** @deprecated use `ctx.req.query` */
  get get(): Readonly<Record<string, string>> { return this.req.query; }
  /** @deprecated use `ctx.req.body` */
  // deno-lint-ignore no-explicit-any
  get post(): any { return this.req.body; }
  /** @deprecated use `ctx.req.files` */
  get files(): Record<string, Promise<UploadedFile> | undefined> { return this.req.files; }
  /** @deprecated use `ctx.req.cookies` */
  get cookie(): Readonly<Record<string, string>> { return this.req.cookies; }
  /** @deprecated use `ctx.req.clientIp` */
  get remoteAddr(): string { return this.req.clientIp; }
  /** @deprecated use `ctx.req.basePath` */
  get appURL(): string { return this.req.basePath; }
  /** @deprecated use `ctx.req.modulePath` */
  get sysURL(): string { return this.req.modulePath; }
  /** @deprecated use `ctx.req.appPath` */
  get appRequestPath(): string { return this.req.appPath; }
  /** @deprecated use `ctx.req.deadline` */
  get deadline(): RequestDeadline { return this.req.deadline; }
  /** @deprecated read `ctx.req.url`, mutate via `ctx.req.url.toURL()` */
  get url(): URL { return this.req.url.toURL(); }

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
    return urlToLocalPath(url, this.req.basePath, this.app);
  }

  static async create(app: App, request: Request, opt: { basePath: string; peerAddr?: string; time?: number; url?: URL }): Promise<RequestContext> {
    const req = await ContextRequest.create(request, {
      ...opt,
      maxSize: Number(await app.settings.core.uploadMaxFileSize ?? "") || undefined,
      trustedProxyHops: app.trustedProxyHops,
    });
    const ctx = new RequestContext();
    ctx.req = req;
    ctx.app = app;
    ctx.sess = await app.sessions.loadFromRequest(req, app.https, req.basePath);
    return ctx;
  }
}

/** Resolve a request URL to a servable local file (module/qg pub dirs); null if it is no static path. */
export function urlToLocalPath(url: string | URL, appURL: string, app: App): string | null {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
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
