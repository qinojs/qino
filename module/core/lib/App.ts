import * as nodePath from "node:path";
import { fromFileUrl, serveFile, type ItemProxy } from "../../../deps.ts";
import { makeRequestContext, requestStorage, urlToLocalPath, type RequestContext } from "./RequestContext.ts";
import { Req } from "./Req.ts";
import { SessionManager } from "./SessionManager.ts";
import { ensureSlash, Output } from "./util.ts";
import { Db } from "./Db.ts";
import { DbFileManager, type DbFile } from "./DbFileManager.ts";
import { createSettingItem } from "./SettingItem.ts";
import { DbTextManager } from "./DbTextManager.ts";
import { ModuleManager, type Module } from "./ModuleManager.ts";
import { Emitter } from "./Emitter.ts";
import { LangManager } from "./LangManager.ts";
import { aptFetch, aptClient, type AptTree, type AptProxy } from "./apt/mod.ts";
import { initRequest } from "./init.ts";

const mainDir: string = fromFileUrl(new URL(".", Deno.mainModule));

const defaultConfig = {
    appPATH: mainDir,
    basePath: "",
    https: false,
    dev: false,
    trustedProxyHops: 0, // proxies in front of the app; 0 = none, x-forwarded-for ignored
    db: "", // mysql://user:pass@host/db, postgresql://user:pass@host/db, sqlite:/path/db.sqlite
};

/** Core events; modules add their own via `declare module "../core/lib/App.ts" { interface AppEvents {...} }`. */
export interface AppEvents {
    "init": { app: App };
    "request-start": { req: Req };
    "action": { ctx: RequestContext };
    "render": { ctx: RequestContext };
    "html-ready": { ctx: RequestContext };
    "respond": { ctx: RequestContext };
    "response-ready": { req: Req; res: Response; ctx?: RequestContext }; // ctx is missing for static files
    "auth-before": { email: string; pw: string };
    "login": { session_old: ItemProxy; id: number };
    "logout": Record<string, never>;
    "dbFile::access": { File: DbFile; access: boolean };
    "dbFile::access2": { File: DbFile; access: boolean };
    "dbFile-used": { dbFile: DbFile; used: boolean };
    "dbFile-remove-fs": { dbFile: DbFile; prevent: boolean };
    [name: string]: Record<string, unknown>; // untyped module events stay allowed
}

/** The central hub of a Qino application. Manages modules, routing, database, sessions, and settings. */
export class App extends Emitter<AppEvents> {
    appPATH: string;
    basePath: string;
    https: boolean;
    dev: boolean;
    trustedProxyHops: number;
    db: Db;
    settings: ItemProxy;
    ctxSettingsSchema: Record<string, unknown> = { properties: {} };
    dbFiles: DbFileManager;
    dbTexts: DbTextManager;
    sessions: SessionManager;
    modules: ModuleManager;
    languages: LangManager;
    t: LangManager["t"];
    aptTree: AptTree = {};
    #apt?: AptProxy;

    // the proxy reads aptTree lazily, so modules added at runtime stay visible
    get apt(): AptProxy { return this.#apt ??= aptClient(this.aptTree); }

    constructor(config: Partial<typeof defaultConfig> = {}) {
        super();
        const cfg = { ...defaultConfig, ...config };
        const appPATH = cfg.appPATH.startsWith("file:") ? fromFileUrl(cfg.appPATH) : cfg.appPATH;

        this.appPATH   = ensureSlash(appPATH);
        this.basePath  = cfg.basePath;
        this.https     = cfg.https;
        this.dev       = cfg.dev;
        this.trustedProxyHops = cfg.trustedProxyHops;

        this.db        = new Db(cfg.db || `sqlite:${this.appPATH}qino.sqlite`);
        this.settings  = createSettingItem(this.db).proxy;
        this.dbFiles   = new DbFileManager(this, this.appPATH + "qg/file/");
        this.dbTexts   = new DbTextManager(this);
        this.sessions  = new SessionManager(this.db);
        this.modules   = new ModuleManager(this);
        this.languages = new LangManager(this);
        this.t         = this.languages.t;
    }

    /** Mandatory boot step, after all modules are imported: ensures the database, migrates the
     *  schema (DDL), and runs module init. Call once before serving — keeps DDL out of the request path. */
    async init(): Promise<void> {
        await this.db.ensureDatabase();  // DB must exist before migration queries run against it
        await this.modules.init();       // migrate schema (DDL) + introspect tables + module init hooks
    }

    /** Web-standard entry point — `Deno.serve({}, app.fetch)`. */
    get fetch(): (req: Request, info?: { remoteAddr?: { hostname?: string } }) => Promise<Response> {
        return (req, info) => this.handle(req, this.basePath, info?.remoteAddr?.hostname);
    }

    import(spec: string): Promise<Module> { return this.modules.import(spec); }
    importAll(dir: string): Promise<void> { return this.modules.importAll(dir); }

    /** The single entry point: `Request` in, `Response` out. `basePath` = the prefix this request is served under. */
    async handle(request: Request, basePath: string = this.basePath, peerAddr = ""): Promise<Response> {
        const req = new Req(request, peerAddr);
        const base = ensureSlash(basePath || "/");
        let ctx: RequestContext;
        try {
            await this.fire("request-start", { req });           // cheap pre-filter, before any DB/session work
            // static files skip the whole context pipeline — no session/db work (switch: the commented call in #route)
            const localPath = urlToLocalPath(req.url, base, this);
            if (localPath) return await this.#static(req, localPath);
            ctx = await makeRequestContext(this, req, base);
        } catch (e: unknown) {
            return this.#earlyError(e);
        }
        return requestStorage.run(ctx, () => this.#run(ctx).finally(() => ctx.cleanup()));
    }

    async #static(req: Req, localPath: string): Promise<Response> {
        const res = await serveFile(req.raw, localPath);
        await this.fire("response-ready", { req, res });
        return res;
    }

    async #run(ctx: RequestContext): Promise<Response> {
        let res: Response;
        try {
            await initRequest(ctx);
            this.sessions.setCookieIfNew(ctx);
            await this.fire("action", { ctx });
            res = await this.#route(ctx);
        } catch (e: unknown) {
            this.#handleError(ctx, e);
            res = await this.#buildResponse(ctx);
        }
        await this.fire("response-ready", { req: ctx.req, res, ctx }); // last hook, sees every response (static, dbFile, api, pages)
        return res;
    }

    /** Explicit, ordered dispatch over the request path — the one routing model. */
    #route(ctx: RequestContext): Response | Promise<Response> {
        const uri = ctx.appRequestPath;

        // Switch to track statics (full session/log pipeline): disable the #static call in
        // handle() and enable this. Plain serveFile — #run already fires response-ready here.
        // const localPath = ctx.urlToLocalPath(ctx.req.url);
        // if (localPath) return serveFile(ctx.req.raw, localPath);

        if (uri === "favicon.ico") return new Response(null, { status: 204 });

        if (uri === "dbFile" || uri.startsWith("dbFile/"))
            return this.dbFiles.output(uri.slice("dbFile/".length), ctx.req.raw);

        // apt always signals via thrown Output (success or error) — caught in #run.
        if (uri === "api" || uri.startsWith("api/"))
            return aptFetch(ctx.req, this.aptTree, "/" + uri.slice("api/".length));

        return this.#renderFallback(ctx);
    }

    /** Fallback for paths that aren't static/dbFile/api: fire the render hooks and build the response. */
    async #renderFallback(ctx: RequestContext): Promise<Response> {
        await this.fire("render", { ctx });
        if (ctx.hasHtml) {
            await this.fire("html-ready", { ctx });
            const html = ctx.html;
            html.lang = ctx.lang;
            const qino = html.jsData.qino ??= {};
            qino.token = ctx.token;
            qino.appURL = ctx.appURL || "/";
            ctx.responseBody = html.render();
        }
        return this.#buildResponse(ctx);
    }

    /** Map a control-flow signal onto the request context's pending response. */
    #handleError(ctx: RequestContext, e: unknown): void {
        if (e instanceof Output) {
            for (const [k, v] of e.buildHeaders()) ctx.responseHeaders.set(k, v);
            ctx.responseBody = e.body;
            ctx.responseStatus = e.status;
        } else {
            console.error("Error:", e);
            ctx.responseStatus = 500;
            ctx.responseBody = "<h1>500 Internal Server Error</h1>";
        }
    }

    /** Errors raised before a request context exists (init, pre-filter, 413). */
    #earlyError(e: unknown): Response {
        if (e instanceof Output) return e.toResponse();
        console.error("Error:", e);
        return new Response("<h1>500 Internal Server Error</h1>", { status: 500 });
    }

    async #buildResponse(ctx: RequestContext): Promise<Response> {
        await this.fire("respond", { ctx });
        const headers = new Headers(ctx.responseHeaders);
        if (headers.has("Location")) return new Response(null, { status: ctx.responseStatus, headers });
        if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-cache, no-store");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(ctx.responseBody, { status: ctx.responseStatus, headers });
    }

    assertAllowedPath(file: string): void {
        if (!file || file.includes("\0")) throw new Output("invalid path", { status: 400 });
        const resolved = nodePath.resolve(file);
        if (resolved !== nodePath.normalize(file) && resolved !== file) throw new Output("invalid path", { status: 400 });
        const roots: string[] = [nodePath.resolve(this.appPATH)];
        for (const mod of Object.values(this.modules.all())) {
            if (mod.dir) roots.push(nodePath.resolve(mod.dir));
        }
        if (!roots.some(root => resolved.startsWith(root + nodePath.sep))) throw new Output("invalid path", { status: 400 });
    }
}
