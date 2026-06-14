import { AsyncLocalStorage } from "node:async_hooks";
import type { Item, ItemProxy } from "../../../deps.ts";
import { HtmlBuilder } from "./HtmlBuilder.ts";
import { uid, clientIp, Output } from "./util.ts";
import * as nodePath from "node:path";
import { userSettingsItem, sessSettingsItem } from "./contextSettings.ts";
import { readUploadFile, type UploadedFile } from "./fileStream.ts";
import type { App } from "./App.ts";
import type { dbEntry_client, dbEntry_usr } from "./qgEntries.ts";
import type { Req } from "./Req.ts";

export class RequestContext {
  app!: App;
  session: ItemProxy = null!;
  sessionToken = "";
  cookie: Record<string, string> = {};
  get: Record<string, string> = {};
  post: Record<string, unknown> = {};
  files: Record<string, UploadedFile> = {};
  requestUri = "/";
  remoteAddr = "";
  responseHeaders: Headers = new Headers();
  responseStatus = 200;
  responseBody: string = "";
  // deno-lint-ignore no-explicit-any
  state: Record<string, any> = {};
  #html: HtmlBuilder | null = null;
  #settingsRoot: Item | null = null;
  lang = "en";
  langUsr = "en";
  langNsPath: string[] = [];
  langNs = "";
  req!: Req;
  clientId: string | null = null;
  sessId: string | null = null;
  logId: Promise<string | null> = Promise.resolve(null);
  loginError: string | undefined; // braucht es den hier eigentlich?
  appURL = "/";
  sysURL = "/m/";
  appRequestUri = "";
  csp: Record<string, Record<string, number>> = {
    "default-src": { "'self'": 1 }, "font-src": { "*": 1, "data:": 1 },
    "img-src": { "'self'": 1, "data:": 1 }, "script-src": { "'self'": 1 },
    "style-src": { "'self'": 1, "'unsafe-inline'": 1 }, "connect-src": { "'self'": 1 }, "frame-src": { "'self'": 1 },
  };
  cspReportUri: string | false = false; // besser innerhalb csp-objekt? ctx.csp.reportUri? geht das?

  get html(): HtmlBuilder { return this.#html ??= new HtmlBuilder(); }
  get hasHtml(): boolean { return this.#html !== null; }

  get url(): URL { return new URL(this.req.url); }
  
  get userId(): number {
    return Number(this.session.liveUser() || 0);
  }
  get user(): dbEntry_usr | null {
    return this.userId ? this.app.db.table('usr').entry(this.userId) as dbEntry_usr : null;
  }
  get client(): dbEntry_client {
    if (!this.clientId) throw new Error("No client id");
    return this.app.db.table('client').entry(this.clientId) as dbEntry_client;
  }

  get settings(): ItemProxy {
    if (!this.#settingsRoot) throw new Error("ctx.settings not initialized - call ctx.initSettings() first");
    return this.#settingsRoot.proxy;
  }
  async initSettings(): Promise<void> { // inkonsistent: ctx.lang wird im LangManager initialisiert (LangManager.initCtx(ctx)), aber settings hier.
    this.#settingsRoot = this.user
      ? await userSettingsItem(this.user, this.app.ctxSettingsSchema)
      : await sessSettingsItem(this.app.db, this.sessId!, this.app.ctxSettingsSchema);
  }



  get dev(): boolean {
    return this.app.dev || !!this.settings.core.dev();
  }
  get token(): string {
    const token = this.session.qg.token;
    if (!token()) this.session.qg.token(uid(11));
    return token() as string;
  }


  urlToLocalPath(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.protocol === "file:") return u.pathname;
      const appRequestUri = decodeURIComponent(u.pathname.slice(this.appURL.length));
      return appRequestUriToLocalPath(appRequestUri, this.app);
    } catch { /* not a URL */ }
    return null;
  }

  async cleanup(): Promise<void> {
    for (const f of Object.values(this.files)) {
      const p = (f as { tmpPath?: unknown })?.tmpPath;
      if (typeof p === "string") await Deno.remove(p).catch(() => {});
    }
  }
}

export async function makeRequestContext(app: App, req: Req, basePath: string): Promise<[RequestContext, boolean]> {

  const appURL = basePath.endsWith("/") ? basePath : basePath + "/";
  const url = new URL(req.url);

  const ct = req.header("content-type") ?? "";

  const maxSize = Number(await app.settings.core.uploadMaxFileSize ?? "") || 100 * 1024 * 1024;
  if (Number(req.header("content-length") ?? "0") > maxSize) throw new Output("Payload Too Large", { status: 413 });

  const rawBody: unknown = req.method === "POST"
    ? (ct.includes("application/json") || ct.includes("application/csp-report") ? await req.json() : await req.parseBody()) : {};
  const post: Record<string, unknown> = {};
  const files: Record<string, UploadedFile> = {};

  for (const [key, val] of Object.entries(rawBody && typeof rawBody === "object" ? rawBody as Record<string, unknown> : {})) {
    if (val instanceof File) {
      files[key] = await readUploadFile(val, { maxSize });
    } else {
      post[key] = val;
    }
  }

  const { sessionToken, sessId, session, isNew } = await app.sessions.loadFromRequest(req, app.https);

  const ctx = new RequestContext();
  Object.assign(ctx, {
    req,
    app,
    appURL,
    sysURL: appURL + "m/",
    appRequestUri: decodeURIComponent(req.path.slice(appURL.length)),
    session,
    sessionToken,
    sessId,
    cookie: req.cookies(),
    get: req.query(),
    post,
    files,
    requestUri: url.pathname + url.search,
    remoteAddr: clientIp(req),
  });

  return [ctx, isNew];
}

function appRequestUriToLocalPath(appRequestUri: string, app: App): string | null {
  const matchM = appRequestUri.match(/^m\/([^/]+)\/pub\/(.*)/);
  if (matchM) {
    const mod = app.modules.get(matchM[1]);
    const base = mod?.dir ?? (app.appPATH + "m/" + matchM[1] + "/");
    return pubPath(base, matchM[2]);
  }
  const matchQg = appRequestUri.match(/^qg\/([^/]+)\/pub\/(.*)/);
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
