import { AsyncLocalStorage } from "node:async_hooks";
import * as nodePath from "node:path";

import { Res } from "./Res.ts";
import { uid } from "../util.ts";
import { userSettingsItem, sessSettingsItem } from "./contextSettings.ts";
import { Req } from "./Req.ts";

import type { Item, ItemProxy } from "../../deps.ts";
import type { App } from "../App.ts";
import type { LoginError } from "../auth.ts";
import type { Client, Usr } from "../rows.ts";
import type { Session } from "../SessionManager.ts";

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
  dev = false;

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
    this.dev = this.app.dev || (!!this.user?.superuser && !!this.settings.core.dev());
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
  /** The signed-in user, loaded during initRequest — columns read synchronously. */
  get user(): Usr | null {
    return this.userId ? this.app.db.table('usr').row<Usr>(this.userId) : null;
  }
  get client(): Client {
    if (!this.clientId) throw new Error("No client id");
    return this.app.db.table('client').row<Client>(this.clientId);
  }
  /** CSRF/form token, not the session cookie token (`ctx.sess.token`). */
  get csrfToken(): string {
    const token = this.sess.data.core.csrfToken;
    if (!token()) this.sess.data.core.csrfToken(uid(11));
    return token()!;
  }

  urlToLocalPath(url: string): string | null {
    return urlToLocalPath(url, this.req.appUrl, this.app);
  }

  static async create(app: App, request: Request, opt: { appUrl: string; peerAddr?: string; time?: number; url?: URL }): Promise<Ctx> {
    const req = await Req.create(request, {
      ...opt,
      maxSize: await app.settings.core.uploadMaxFileSize as number | undefined,
      trustedProxyHops: app.trustedProxyHops,
    });
    const ctx = new Ctx();
    ctx.req = req;
    ctx.app = app;
    ctx.sess = await app.sessions.loadFromRequest(req, app.https, req.appUrl);
    return ctx;
  }
}

/** Resolve a request URL to a servable local file (module/data pub dirs); null if it is no static path. */
export function urlToLocalPath(url: string | URL, appUrl: string, app: App): string | null {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.pathname.startsWith(appUrl)) return null;
    const appRequestPath = decodeURIComponent(u.pathname.slice(appUrl.length));
    return appRequestPathToLocalPath(appRequestPath, app);
  } catch { /* not a URL */ }
  return null;
}

// module/data segment must be a plain name, never "."/".." (would shift the served root)
const safeSeg = (s: string) => s !== "." && s !== ".." ? s : null;

function appRequestPathToLocalPath(appRequestPath: string, app: App) {
  const matchM = appRequestPath.match(/^m\/([^/]+)\/pub\/(.*)/);
  if (matchM && safeSeg(matchM[1])) {
    const mod = app.modules.get(matchM[1]);
    return pubPath(mod?.dir ?? (app.dir + "m/" + matchM[1] + "/"), matchM[2]);
  }
  const matchD = appRequestPath.match(/^d\/([^/]+)\/pub\/(.*)/);
  return matchD && safeSeg(matchD[1]) ? pubPath(app.dir + "data/" + matchD[1] + "/", matchD[2]) : null;
}

function pubPath(root: string, file: string) {
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
