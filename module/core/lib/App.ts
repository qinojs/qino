import * as nodePath from "node:path";

import { fromFileUrl, serveFile } from "../deps.ts";
import { Ctx, requestStorage, urlToLocalPath } from "./ctx/Ctx.ts";
import { SessionManager } from "./SessionManager.ts";
import { ensureSlash, Output } from "./util.ts";
import { Db } from "./db/Db.ts";
import { DbFileManager } from "./DbFileManager.ts";
import { createSettingItem } from "./SettingItem.ts";
import { DbTextManager } from "./DbTextManager.ts";
import { FileTransformer } from "./transform/mod.ts";
import { ModuleManager } from "./ModuleManager.ts";
import { StoreManager } from "./StoreManager.ts";
import { Emitter } from "./Emitter.ts";
import { LangManager } from "./LangManager.ts";
import { apiFetch, apiClient } from "./api/mod.ts";
import { initRequest } from "./ctx/init.ts";

import type { ItemProxy } from "../deps.ts";
import type { ApiTree, ApiProxy } from "./api/mod.ts";
import type { DbFile } from "./DbFileManager.ts";

const mainDir = fromFileUrl(new URL(".", Deno.mainModule));

const DEFAULT_CONFIG = {
    dir: mainDir,
    appUrl: "",
    https: false,
    dev: false,
    trustedProxyHops: 0, // proxies in front of the app; 0 = none, x-forwarded-for ignored
    db: "", // mysql://user:pass@host/db, postgresql://user:pass@host/db, sqlite:/path/db.sqlite
};

/** Statuses a response must not carry a body with. */
const NULL_BODY = new Set([204, 205, 304]);

/** Set on every response unless it already carries them. */
const RESPONSE_HEADERS: Record<string, string> = {
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
};

/** Core events. Module events are allowed but untyped — JSR forbids augmenting this map from a module. */
export interface AppEvents {
    "request-start": { request: Request; peerAddr: string; time: number, base: string };
    "authenticate": { ctx: Ctx };
    "route": { ctx: Ctx };
    "render": { ctx: Ctx };
    "html-ready": { ctx: Ctx };
    "respond": { ctx: Ctx };
    "response-ready": { request: Request; res: Response; peerAddr: string; time: number; ctx?: Ctx }; // no ctx for static files and early errors
    "suspicious": { ctx: Ctx; weight?: number; reason?: string }; // a module noticed something abusive; consumers score the client. weight defaults to 1
    "auth:login": { oldSession: Record<string, any>; usrId: number }; // the session's values before it was emptied
    "dbFile:access": { file: DbFile; access: boolean };          // fast path
    "dbFile:access-fallback": { file: DbFile; access: boolean }; // slow path, only fired when access still unresolved
    "dbFile:unlink-before": { file: DbFile; prevent: boolean };
    // deno-lint-ignore no-explicit-any -- module events carry their own payloads; typing them needs a per-module emitter, not a global map
    [name: string]: any;
}

export const urlOf = (ctx: Ctx): string => ctx.req.url.origin + ctx.req.appUrl;

/** The central hub of a Qino application. Manages modules, routing, database, sessions, and settings. */
export class App extends Emitter<AppEvents> {
    dir: string;
    appUrl: string;
    https: boolean;
    dev: boolean;
    trustedProxyHops: number;
    db: Db;
    settings: ItemProxy;
    ctxSettingsSchema: Record<string, unknown> = { properties: {} };
    dbFiles: DbFileManager;
    dbTexts: DbTextManager;
    fileTransformer: FileTransformer;
    sessions: SessionManager;
    modules: ModuleManager;
    stores: StoreManager;
    languages: LangManager;
    t: LangManager["t"];
    /** What the modules declare — the loader mounts each module's `api` export under its name. */
    apiTree: ApiTree = {};
    #api?: ApiProxy;
    /** How you call it: `app.api.cms.node(42).get()`. Reads apiTree lazily, so runtime modules stay visible. */
    get api(): ApiProxy { return this.#api ??= apiClient(this.apiTree); }

    constructor(config: Partial<typeof DEFAULT_CONFIG> = {}) {
        super();
        const cfg = { ...DEFAULT_CONFIG, ...config };
        const dir = cfg.dir.startsWith("file:") ? fromFileUrl(cfg.dir) : cfg.dir;

        this.dir   = ensureSlash(dir);
        this.appUrl    = ensureSlash(cfg.appUrl || "/");
        this.https     = cfg.https;
        this.dev       = cfg.dev;
        this.trustedProxyHops = cfg.trustedProxyHops;

        this.db        = new Db(cfg.db || `sqlite:${this.dir}qino.sqlite`);
        this.settings  = createSettingItem(this.db).proxy;
        this.dbFiles   = new DbFileManager(this, this.dir + "data/core/file/");
        this.dbTexts   = new DbTextManager(this);
        this.fileTransformer = FileTransformer.create({ cacheDir: this.dir + "cache/core/file/" });
        this.sessions  = new SessionManager(this.db);
        this.modules   = new ModuleManager(this);
        this.modules.add(new URL("../plugin.ts", import.meta.url)); // the root of the needs graph — every app has it
        this.stores    = new StoreManager(this);
        this.languages = new LangManager(this);
        this.t         = this.languages.t;
    }

    /** Mandatory boot step, after all modules are imported: ensures the database, migrates the
     *  schema (DDL), and runs module init. Call once before serving — keeps DDL out of the request path. */
    async init(): Promise<void> {
        await this.db.ensureDatabase();  // DB must exist before migration queries run against it
        await this.stores.init();
        await this.modules.init();       // migrate schema (DDL) + introspect tables + module init hooks
    }

    /** `await using app = new App(...)` — closes the database. Files under `dir` are the caller's. */
    [Symbol.asyncDispose](): Promise<void> { return this.db.close(); }

    /** Web-standard entry point — `Deno.serve({}, app.fetch)`. */
    get fetch(): (req: Request, info?: { remoteAddr?: { hostname?: string } }) => Promise<Response> {
        return (req, info) => this.handle(req, this.appUrl, info?.remoteAddr?.hostname);
    }

    /** The single entry point: `Request` in, `Response` out. `appUrl` = the prefix this request is served under. */
    async handle(request: Request, appUrl: string = this.appUrl, peerAddr = ""): Promise<Response> {
        const time = performance.now();
        const base = ensureSlash(appUrl || "/");
        const meta = { request, peerAddr, time, base };
        let ctx: Ctx;
        try {
// console.log('start');
            await this.fire("request-start", meta); // cheap pre-filter, before any DB/session work
            const url = new URL(request.url);
            const localPath = urlToLocalPath(url, base, this);
            if (localPath) return this.#finish(await serveFile(request, localPath), meta);
            ctx = await Ctx.create(this, request, { appUrl: base, peerAddr, time, url });
        } catch (e) {
            return this.#finish(earlyError(e), meta);
        }
        return requestStorage.run(ctx, () => this.#run(ctx).finally(() => ctx.req.cleanup()));
    }

    async #run(ctx: Ctx): Promise<Response> {
        let res: Response;
        try {
            await initRequest(ctx);
            if (!ctx.statelessAuth) this.sessions.setCookieIfNew(ctx);
            await this.fire("route", { ctx });
            res = await this.#route(ctx);
        } catch (e) {
            applyThrown(ctx, e);
            res = await this.#buildResponse(ctx);
        }
        return this.#finish(res, { request: ctx.req.raw, peerAddr: ctx.req.peerAddr, time: ctx.req.time, ctx });
    }

    /** Explicit, ordered dispatch over the request path — the one routing model. */
    #route(ctx: Ctx): Promise<Response> {
        const uri = ctx.req.appPath;

        if (uri === "dbFile" || uri.startsWith("dbFile/"))
            return this.dbFiles.output(uri.slice("dbFile/".length), ctx.req.raw);

        // api always signals via thrown Output (success or error) — caught in #run.
        // stateless requests carry no ambient cookie, so CSRF checks don't apply
        if (uri === "api" || uri.startsWith("api/"))
            return apiFetch(ctx.req, this.apiTree, "/" + uri.slice("api/".length), { auth: () => ctx.statelessAuth });

        return this.#render(ctx);
    }

    /** The normal path: whatever isn't dbFile or api, the modules render. */
    async #render(ctx: Ctx): Promise<Response> {
        await this.fire("render", { ctx });
        // nobody serves a favicon: say so, instead of letting the browser ask again
        if (ctx.req.appPath === "favicon.ico" && !ctx.res.hasHtml && !ctx.res.body) ctx.res.status = 204;
        return this.#buildResponse(ctx);
    }

    async #buildResponse(ctx: Ctx): Promise<Response> {
        const res = ctx.res;
        // A document is the answer unless something set a body or a Location — so any route can end with
        // `throw new Output()` and the page it built gets sent.
        if (res.hasHtml && !res.body && !res.headers.has("Location")) {
            await this.fire("html-ready", { ctx });
            res.html.lang = ctx.lang;
            const qino = res.html.jsData.qino ??= {};
            qino.csrfToken = ctx.csrfToken;
            qino.appUrl = ctx.req.appUrl;
            res.body = res.html.render();
            if (!res.headers.has("Content-Type")) res.headers.set("Content-Type", "text/html; charset=utf-8");
        }
        await this.fire("respond", { ctx });
        const { status, headers } = res;
        if (headers.has("Location")) return new Response(null, { status, headers });
        if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-cache, no-store");
        return new Response(NULL_BODY.has(status) ? null : res.body, { status, headers });
    }

    /** The one exit — every response passes here, whatever built it. Headers are defaults: whoever set one keeps it. */
    async #finish(res: Response, meta: Omit<AppEvents["response-ready"], "res">): Promise<Response> {
        for (const [name, value] of Object.entries(RESPONSE_HEADERS))
            if (!res.headers.has(name)) res.headers.set(name, value);
        await this.fire("response-ready", { ...meta, res });
// console.log('done');
        return res;
    }

    /** The public address with a trailing slash, from `core.url` — the route hook fills it in. */
    async url(): Promise<string> {
        const set = String(await this.settings.core.url ?? "");
        if (!set) throw new Error("core.url is not set");
        return set.replace(/\/?$/, "/");
    }

    assertAllowedPath(file: string): void {
        if (!file || file.includes("\0")) throw new Output("invalid path", { status: 400 });
        const resolved = nodePath.resolve(file);
        if (resolved !== nodePath.normalize(file) && resolved !== file) throw new Output("invalid path", { status: 400 });
        const roots = [nodePath.resolve(this.dir)];
        for (const mod of this.modules.all().values()) if (mod.dir) roots.push(nodePath.resolve(mod.dir));
        if (!roots.some(root => resolved.startsWith(root + nodePath.sep))) throw new Output("invalid path", { status: 400 });
    }
}

/** Map whatever ended the route — a control-flow signal or a real error — onto the pending response. */
function applyThrown(ctx: Ctx, e: unknown): void {
    if (e instanceof Output) {
        for (const [k, v] of e.buildHeaders()) ctx.res.headers.set(k, v);
        // A signal overrides only what it carries (200 = no opinion), so a bare `throw new Output()`
        // ends the route without wiping what it put on ctx.res.
        if (e.body !== undefined) ctx.res.body = e.body;
        if (e.status !== 200) ctx.res.status = e.status;
    } else {
        console.error("Error:", e);
        ctx.res.status = 500;
        ctx.res.body = ERROR_500;
    }
}

const ERROR_500 = "<h1>500 Internal Server Error</h1>";

/** Errors raised before a request context exists (init, pre-filter, 413). */
function earlyError(e: unknown): Response {
    if (e instanceof Output) return e.toResponse();
    console.error("Error:", e);
    return new Response(ERROR_500, { status: 500 });
}
