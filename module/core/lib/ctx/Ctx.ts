import { AsyncLocalStorage } from "node:async_hooks";
import type { Item, ItemProxy } from "../../../../deps.ts";
import { Res } from "./Res.ts";
import { uid } from "../util.ts";
import * as nodePath from "node:path";
import { userSettingsItem, sessSettingsItem } from "./contextSettings.ts";
import { Req } from "./Req.ts";
import type { App } from "../App.ts";
import type { dbEntry_client, dbEntry_usr } from "../qgEntries.ts";
import type { Session } from "../SessionManager.ts";
import type { LoginError } from "../auth.ts";

export class Ctx {
  app!: App;
  req!: Req;
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

  res: Res = new Res();

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

  static async create(app: App, request: Request, opt: { basePath: string; peerAddr?: string; time?: number; url?: URL }): Promise<Ctx> {
    const req = await Req.create(request, {
      ...opt,
      maxSize: Number(await app.settings.core.uploadMaxFileSize ?? "") || undefined,
      trustedProxyHops: app.trustedProxyHops,
    });
    const ctx = new Ctx();
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

export const requestStorage: AsyncLocalStorage<Ctx> = new AsyncLocalStorage();

export function getCtx(): Ctx {
  const ctx = requestStorage.getStore();
  if (!ctx) throw new Error("getCtx() called outside of request context");
  return ctx;
}
