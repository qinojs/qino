import * as nodePath from "node:path";
import { fromFileUrl, serveFile, type ItemProxy } from "../deps.ts";
import { Ctx, requestStorage, urlToLocalPath } from "./ctx/Ctx.ts";
import { SessionManager } from "./SessionManager.ts";
import { ensureSlash, Output } from "./util.ts";
import { Db } from "./db/Db.ts";
import { DbFileManager, type DbFile } from "./DbFileManager.ts";
import { createSettingItem } from "./SettingItem.ts";
import { DbTextManager } from "./DbTextManager.ts";
import { FileTransformer } from "./transform/mod.ts";
import { ModuleManager, type Module } from "./ModuleManager.ts";
import { StoreManager } from "./StoreManager.ts";
import { Emitter } from "./Emitter.ts";
import { LangManager } from "./LangManager.ts";
import { aptFetch, aptClient, type AptTree, type AptProxy } from "./apt/mod.ts";
import { initRequest } from "./ctx/init.ts";

const mainDir = fromFileUrl(new URL(".", Deno.mainModule));

const DEFAULT_CONFIG = {
    appPATH: mainDir,
    appUrl: "",
    https: false,
    dev: false,
    trustedProxyHops: 0, // proxies in front of the app; 0 = none, x-forwarded-for ignored
    db: "", // mysql://user:pass@host/db, postgresql://user:pass@host/db, sqlite:/path/db.sqlite
};

/** Core events. Module events are allowed but untyped — JSR forbids augmenting this map from a module. */
export interface AppEvents {
    "request-start": { request: Request; peerAddr: string; time: number };
    "authenticate": { ctx: Ctx };
    "route": { ctx: Ctx };
    "render": { ctx: Ctx };
    "html-ready": { ctx: Ctx };
    "respond": { ctx: Ctx };
    "response-ready": { request: Request; res: Response; peerAddr: string; time: number; ctx?: Ctx }; // ctx is missing for static files
    "suspicious": { ctx: Ctx; weight?: number; reason?: string }; // a module noticed something abusive; consumers score the client. weight defaults to 1
    "auth:login": { oldSession: Record<string, any>; usrId: number }; // the session's values before it was emptied
    "dbFile:access": { file: DbFile; access: boolean };          // fast path
    "dbFile:access-fallback": { file: DbFile; access: boolean }; // slow path, only fired when access still unresolved
    "dbFile:unlink-before": { file: DbFile; prevent: boolean };
    // deno-lint-ignore no-explicit-any -- module events carry their own payloads; typing them needs a per-module emitter, not a global map
    [name: string]: any;
}

// Deliberately runtime-global, not per-app: it exists to spot instances sharing one appPATH,
// which would have them write over each other in data/, cache/ and tmp/. Paths only, no App refs.
const appPathUses = new Map<string, number>();

/** How many App instances of this runtime resolved to that appPATH. More than one is a misconfiguration. */
export function appPathInstances(appPATH: string): number {
    return appPathUses.get(appPATH) ?? 0;
}

/** The central hub of a Qino application. Manages modules, routing, database, sessions, and settings. */
export class App extends Emitter<AppEvents> {
    appPATH: string;
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
    aptTree: AptTree = {};
    #apt?: AptProxy;

    // the proxy reads aptTree lazily, so modules added at runtime stay visible
    get apt(): AptProxy { return this.#apt ??= aptClient(this.aptTree); }

    constructor(config: Partial<typeof DEFAULT_CONFIG> = {}) {
        super();
        const cfg = { ...DEFAULT_CONFIG, ...config };
        const appPATH = cfg.appPATH.startsWith("file:") ? fromFileUrl(cfg.appPATH) : cfg.appPATH;

        this.appPATH   = ensureSlash(appPATH);
        appPathUses.set(this.appPATH, (appPathUses.get(this.appPATH) ?? 0) + 1);
        this.appUrl    = ensureSlash(cfg.appUrl || "/");
        this.https     = cfg.https;
        this.dev       = cfg.dev;
        this.trustedProxyHops = cfg.trustedProxyHops;

        this.db        = new Db(cfg.db || `sqlite:${this.appPATH}qino.sqlite`);
        this.settings  = createSettingItem(this.db).proxy;
        this.dbFiles   = new DbFileManager(this, this.appPATH + "data/core/file/");
        this.dbTexts   = new DbTextManager(this);
        this.fileTransformer = FileTransformer.create({ cacheDir: this.appPATH + "cache/core/file/" });
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

    /** Web-standard entry point — `Deno.serve({}, app.fetch)`. */
    get fetch(): (req: Request, info?: { remoteAddr?: { hostname?: string } }) => Promise<Response> {
        return (req, info) => this.handle(req, this.appUrl, info?.remoteAddr?.hostname);
    }

    import(spec: string): Promise<Module> { return this.modules.import(spec); }
    link(name: string): Promise<void> { return this.modules.link(name); }
    unlink(name: string): void { this.modules.unlink(name); }

    /** The single entry point: `Request` in, `Response` out. `appUrl` = the prefix this request is served under. */
    async handle(request: Request, appUrl: string = this.appUrl, peerAddr = ""): Promise<Response> {
        const time = performance.now();
        const base = ensureSlash(appUrl || "/");
        let ctx: Ctx;
        try {
            await this.fire("request-start", { request, peerAddr, time }); // cheap pre-filter, before any DB/session work
            const url = new URL(request.url);
            const localPath = urlToLocalPath(url, base, this);
            if (localPath) return await this.#static(request, peerAddr, time, localPath);
            ctx = await Ctx.create(this, request, { appUrl: base, peerAddr, time, url });
        } catch (e: unknown) {
            return earlyError(e);
        }
        return requestStorage.run(ctx, () => this.#run(ctx).finally(() => ctx.req.cleanup()));
    }

    async #static(request: Request, peerAddr: string, time: number, localPath: string): Promise<Response> {
        const res = await serveFile(request, localPath);
        await this.fire("response-ready", { request, res, peerAddr, time });
        return res;
    }

    async #run(ctx: Ctx): Promise<Response> {
        let res: Response;
        try {
            await initRequest(ctx);
            if (!ctx.statelessAuth) this.sessions.setCookieIfNew(ctx);
            await this.fire("route", { ctx });
            res = await this.#route(ctx);
        } catch (e: unknown) {
            handleError(ctx, e);
            res = await this.#buildResponse(ctx);
        }
        // last hook, sees every response (static, dbFile, api, pages)
        await this.fire("response-ready", { request: ctx.req.raw, res, peerAddr: ctx.req.peerAddr, time: ctx.req.time, ctx });
        return res;
    }

    /** Explicit, ordered dispatch over the request path — the one routing model. */
    #route(ctx: Ctx): Response | Promise<Response> {
        const uri = ctx.req.appPath;

        if (uri === "favicon.ico") return new Response(null, { status: 204 });

        if (uri === "dbFile" || uri.startsWith("dbFile/"))
            return this.dbFiles.output(uri.slice("dbFile/".length), ctx.req.raw);

        // apt always signals via thrown Output (success or error) — caught in #run.
        // stateless requests carry no ambient cookie, so CSRF checks don't apply
        if (uri === "api" || uri.startsWith("api/"))
            return aptFetch(ctx.req, this.aptTree, "/" + uri.slice("api/".length), { auth: () => ctx.statelessAuth });

        return this.#renderFallback(ctx);
    }

    /** Fallback for paths that aren't static/dbFile/api: fire the render hooks and build the response. */
    async #renderFallback(ctx: Ctx): Promise<Response> {
        await this.fire("render", { ctx });
        if (ctx.res.hasHtml) {
            await this.fire("html-ready", { ctx });
            const html = ctx.res.html;
            html.lang = ctx.lang;
            const qino = html.jsData.qino ??= {};
            qino.csrfToken = ctx.csrfToken;
            qino.appUrl = ctx.req.appUrl;
            ctx.res.body = html.render();
        }
        return this.#buildResponse(ctx);
    }

    async #buildResponse(ctx: Ctx): Promise<Response> {
        await this.fire("respond", { ctx });
        const headers = new Headers(ctx.res.headers);
        if (headers.has("Location")) return new Response(null, { status: ctx.res.status, headers });
        if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-cache, no-store");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(ctx.res.body, { status: ctx.res.status, headers });
    }

    assertAllowedPath(file: string): void {
        if (!file || file.includes("\0")) throw new Output("invalid path", { status: 400 });
        const resolved = nodePath.resolve(file);
        if (resolved !== nodePath.normalize(file) && resolved !== file) throw new Output("invalid path", { status: 400 });
        const roots = [nodePath.resolve(this.appPATH)];
        for (const mod of Object.values(this.modules.all())) {
            if (mod.dir) roots.push(nodePath.resolve(mod.dir));
        }
        if (!roots.some(root => resolved.startsWith(root + nodePath.sep))) throw new Output("invalid path", { status: 400 });
    }
}

/** Map a control-flow signal onto the request context's pending response. */
function handleError(ctx: Ctx, e: unknown): void {
    if (e instanceof Output) {
        for (const [k, v] of e.buildHeaders()) ctx.res.headers.set(k, v);
        ctx.res.body = e.body;
        ctx.res.status = e.status;
    } else {
        console.error("Error:", e);
        ctx.res.status = 500;
        ctx.res.body = "<h1>500 Internal Server Error</h1>";
    }
}

/** Errors raised before a request context exists (init, pre-filter, 413). */
function earlyError(e: unknown): Response {
    if (e instanceof Output) return e.toResponse();
    console.error("Error:", e);
    return new Response("<h1>500 Internal Server Error</h1>", { status: 500 });
}
