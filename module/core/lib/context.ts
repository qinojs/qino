/**
 * Per-request context using AsyncLocalStorage.
 * Replaces PHP's implicit per-process/per-request global state:
 * G(), $_SESSION, $_GET, $_POST, $_FILES, $_COOKIE, $_SERVER, etc.
 */


import { AsyncLocalStorage } from "node:async_hooks";
import { getCookie, basePath } from "../../../deps.ts";
import { HtmlBuilder } from "./HtmlBuilder.ts";
import { userSettingsItem, sessSettingsItem } from "./CustomSettingItem.ts";
import { readUploadFile } from "./fileStream.ts";
import type { App } from "../server.ts";
import type { Item, ItemProxy } from "../../../deps.ts";
import type { Context } from "../../../deps.ts";
import type { dbEntry_client, dbEntry_usr } from "./qgEntries.ts";

export class RequestContext {
  app!: App;
  session: ItemProxy = null!;
  sessionToken = "";
  cookie: Record<string, string> = {};
  get: Record<string, string> = {};
  post: Record<string, unknown> = {};
  files: Record<string, unknown> = {};
  server = {
    REQUEST_URI: "/", HTTP_HOST: "", HTTP_REFERER: "", HTTP_USER_AGENT: "",
    HTTP_ACCEPT_LANGUAGE: "", HTTP_IF_NONE_MATCH: "", HTTP_RANGE: "", HTTP_DPR: "",
    REMOTE_ADDR: "", SCHEME: "http" as "http" | "https", DOCUMENT_ROOT: "", SCRIPT_FILENAME: "",
  };
  responseHeaders: Headers = new Headers();
  responseStatus = 200;
  responseBody: string = "";
  // deno-lint-ignore no-explicit-any
  state: Record<string, any> = {};

  get html(): HtmlBuilder { return this.#html ??= new HtmlBuilder(this); }
  get hasHtml(): boolean { return this.#html !== null; }
  #html: HtmlBuilder | null = null;

  lang = "en";
  langUsr = "en";
  langNsPath: string[] = []; langNs = "";
  req!: Request;
  clientId: string | null = null;
  sessId: string | null = null;
  logId: string | null = null;

  get userId(): number {
    return parseInt(String(this.session.liveUser() ?? "0")) || 0;
  }
  get user(): dbEntry_usr | null {
    return this.userId ? this.app.db.table('usr').Entry(this.userId) as dbEntry_usr : null;
  }
  get client(): dbEntry_client {
    if (!this.clientId) throw new Error("No client id");
    return this.app.db.table('client').Entry(this.clientId) as dbEntry_client;
  }

  get settings(): ItemProxy {
    if (!this.#settingsRoot) throw new Error("ctx.settings not initialized - call ctx.initSettings() first");
    return this.#settingsRoot.proxy;
  }
  async initSettings(): Promise<void> {
    this.#settingsRoot = this.user
      ? await userSettingsItem(this.user, this.app.ctxSettingsSchema)
      : await sessSettingsItem(this.app.db, this.sessId!, this.app.ctxSettingsSchema);
  }
  #settingsRoot: Item | null = null;


  settingCache: Map<number, unknown> = new Map();
  entryCache: Map<string, Map<string, unknown>> = new Map();
  loginError: string | undefined; 
  appURL = "/"; 
  sysURL = "/m/"; 
  appRequestUri = "";
  csp: Record<string, Record<string, number>> = {
    "default-src": { "'self'": 1 }, "font-src": { "*": 1, "data:": 1 },
    "img-src": { "'self'": 1, "data:": 1 }, "script-src": { "'self'": 1, "'unsafe-inline'": 1 },
    "style-src": { "'self'": 1, "'unsafe-inline'": 1 }, "connect-src": { "'self'": 1 }, "frame-src": { "'self'": 1 },
  };
  cspReportUri: string | false = false;
  //customSettings: any = null;
  get token(): string {
    const token = this.session.qg.token;
    if (!token()) this.session.qg.token(crypto.randomUUID().replace(/-/g, "").slice(0, 12));
    return token() as string;
  }
}

export async function makeRequestContext(app: App, c: Context): Promise<[RequestContext, boolean]> {

  // const existing = c.get("ctx") as RequestContext | undefined; needed?
  // if (existing) return [existing, false];

  const bPath = basePath(c);
  const appURL = bPath.endsWith("/") ? bPath : bPath + "/";
  const req = c.req;
  const url = new URL(req.url);
  const ct = req.header("content-type") ?? "";
  const rawBody: Record<string, unknown> = req.method === "POST"
    ? (ct.includes("application/json") ? await req.json() : await req.parseBody())
    : {};
  const post: Record<string, unknown> = {};
  const files: Record<string, unknown> = {};
  const uploadMaxFileSize = parseInt(String(await app.settings.core.uploadMaxFileSize ?? "")) || 100 * 1024 * 1024;

  for (const [key, val] of Object.entries(rawBody)) {
    if (val instanceof File) {
      files[key] = await readUploadFile(val, { maxSize: uploadMaxFileSize });
    } else {
      post[key] = val;
    }
  }

  const { sessionToken, sessId, session, isNew } = await app.sessions.loadFromRequest(c);

  const ctx = new RequestContext();
  Object.assign(ctx, {
    app,
    appURL,
    sysURL: appURL + "m/",
    appRequestUri: decodeURIComponent(req.path.slice(appURL.length)),
    session,
    sessionToken,
    sessId,
    cookie: getCookie(c),
    get: req.query(),
    post,
    files,
    server: {
      REQUEST_URI: url.pathname + url.search,
      HTTP_HOST: req.header("host") ?? "", HTTP_REFERER: req.header("referer") ?? "",
      HTTP_USER_AGENT: req.header("user-agent") ?? "", HTTP_ACCEPT_LANGUAGE: req.header("accept-language") ?? "",
      HTTP_IF_NONE_MATCH: req.header("if-none-match") ?? "", HTTP_RANGE: req.header("range") ?? "",
      HTTP_DPR: req.header("dpr") ?? "",
      REMOTE_ADDR: (c.env as Record<string, string>)?.["REMOTE_ADDR"] ?? req.header("x-forwarded-for") ?? "",
      SCHEME: url.protocol === "https:" ? "https" : "http",
      DOCUMENT_ROOT: app.config.appPATH, SCRIPT_FILENAME: app.config.appPATH + "server.ts",
    },
  });

  ctx.req = req.raw;
  ctx.state.Answer = {};

  return [ctx, isNew];
}

export const requestStorage = new AsyncLocalStorage<RequestContext>();

export function getCtx(): RequestContext {
  const ctx = requestStorage.getStore();
  if (!ctx) throw new Error("getCtx() called outside of request context");
  return ctx;
}
