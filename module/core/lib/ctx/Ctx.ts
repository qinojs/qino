import { AsyncLocalStorage } from "node:async_hooks";
import * as nodePath from "node:path";

import { keyed, uid } from "../crypto.ts";
import { fs } from "../fs.ts";
import { Res } from "./Res.ts";
import { userSettingsItem, sessSettingsItem } from "./contextSettings.ts";
import { Req } from "./Req.ts";

import type { Item, ItemProxy } from "../../deps.ts";
import type { App } from "../App.ts";
import type { LoginError } from "../auth/login.ts";
import type { Client, Usr } from "../rows.ts";
import type { Session } from "../SessionManager.ts";

export class Ctx {
  app!: App;
  req!: Req;
  sess: Session = null!;
  clientId: string | null = null;
  logId: Promise<string | null> = Promise.resolve(null);
  loginError?: LoginError;
  loginRetryAfter?: number; // seconds to wait after a `throttled` login
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
      : await sessSettingsItem(this.sess, this.app.ctxSettingsSchema);
    this.dev = this.app.dev || (!!this.user?.superuser && !!this.settings.core.dev());
  }

  #authUserId = 0;
  /** A token (API key, …) names its user and device (`api_key:12`). The device becomes the request's
   *  client and session, identified by a secret hash that never leaves the server. */
  async authenticate(userId: number, device: string): Promise<void> {
    this.#authUserId = userId;
    const hash = await keyed(this.app, ["core.device", String(userId), device], 22);
    const clients = this.app.db.table("client");
    const find = () => clients.rowBy("hash", hash);
    // a parallel request may have inserted it: then read that row
    this.clientId = String(await find() ?? await clients.add({ hash }).catch(find));
    this.sess = await this.app.sessions.load(hash, true);
  }
  /** True if a non-cookie token (API key, …) identifies this request. */
  get statelessAuth(): boolean { return this.#authUserId !== 0; }

  get userId(): number {
    return this.#authUserId || Number(this.sess.data.core.userId() || 0);
  }
  /** The signed-in user, loaded in initRequest — columns are read synchronously. */
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
      assetRev: app.assetRev,
      trustedProxyHops: app.trustedProxyHops,
    });
    const ctx = new Ctx();
    ctx.req = req;
    ctx.app = app;
    return ctx;
  }
}

/** Map a request URL to a local file (module/data pub dirs); null if not a static path. */
export function urlToLocalPath(url: string | URL, appUrl: string, app: App): string | null {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.pathname.startsWith(appUrl)) return null;
    const appRequestPath = decodeURIComponent(u.pathname.slice(appUrl.length));
    return appRequestPathToLocalPath(appRequestPath, app);
  } catch { /* not a URL */ }
  return null;
}

// the module/data segment must be a plain name, never "."/".."
const safeSeg = (s: string) => s !== "." && s !== ".." ? s : null;

function appRequestPathToLocalPath(appRequestPath: string, app: App) {
  const matchM = appRequestPath.match(/^m(?:\.\w+)?\/([^/]+)\/pub\/(.*)/);
  if (matchM && safeSeg(matchM[1])) {
    const mod = app.modules.get(matchM[1]);
    // Not registered yet: its mirror is where import() put it (same layout as Module.pubDir).
    return pubPath(mod?.pubDir ?? `${app.dir}cache/${matchM[1]}/remote/pub`, matchM[2]);
  }
  const matchD = appRequestPath.match(/^d(?:\.\w+)?\/([^/]+)\/pub\/(.*)/);
  return matchD && safeSeg(matchD[1]) ? pubPath(`${app.dir}data/${matchD[1]}/pub`, matchD[2]) : null;
}

function pubPath(root: string, file: string) {
  if (!file || file.includes("\0")) return null;
  const pub = nodePath.resolve(root), target = nodePath.resolve(pub, file);
  const rel = nodePath.relative(pub, target);
  return rel && rel !== ".." && !rel.startsWith(".." + nodePath.sep) ? target : null;
}

export const requestStorage: AsyncLocalStorage<Ctx> = new AsyncLocalStorage();

// In dev, requests read files fresh; outside a request the default applies.
const ttl = fs.ttl;
fs.ttl = () => requestStorage.getStore()?.dev ? 0 : ttl();

export function getCtx(): Ctx {
  const ctx = requestStorage.getStore();
  if (!ctx) throw new Error("getCtx() called outside of request context");
  return ctx;
}
