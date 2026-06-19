import * as nodePath from "node:path";
import { fromFileUrl, serveFile, type ItemProxy } from "../../../deps.ts";
import { makeRequestContext, requestStorage, type RequestContext } from "./RequestContext.ts";
import { Req } from "./Req.ts";
import { SessionManager } from "./SessionManager.ts";
import { ensureSlash, Output } from "./util.ts";
import { Db } from "./Db.ts";
import { DbFileManager } from "./DbFileManager.ts";
import { createSettingItem } from "./SettingItem.ts";
import { DbTextManager } from "./DbTextManager.ts";
import { ModuleManager, type Module } from "./ModuleManager.ts";
import { LangManager } from "./LangManager.ts";
import { aptFetch, aptClient, type AptTree, type AptProxy } from "./apt/mod.ts";
import { initClient, initLog, touchSession } from "./init.ts";
import { authListen } from "./auth.ts";

const mainDir:string = fromFileUrl(new URL(".", Deno.mainModule));

const defaultConfig = {
    appPATH: mainDir,
    basePath: "",
    https: false,
    dev: false,
    trustedProxyHops: 0, // proxies in front of the app; 0 = none, x-forwarded-for ignored
    dbHost: "localhost",
    dbName: "",
    dbUser: "",
    dbPass: "",
    db: "", // full connection string override, e.g. "sqlite:/path/db.sqlite" or "postgresql://user:pass@host/db"
};

/** The central hub of a Qino application. Manages modules, routing, database, sessions, and settings. */
export class App {
    appPATH: string;
    basePath: string;
    https: boolean;
    dev: boolean;
    trustedProxyHops: number;
    db: Db;
    settings: ItemProxy;
    ctxSettingsSchema: object = { properties: {} };
    dbFiles: DbFileManager;
    dbTexts: DbTextManager;
    sessions: SessionManager;
    modules: ModuleManager;
    languages: LangManager;
    t: LangManager["t"];
    aptTree: AptTree = {};
    #events: Record<string, ((data: Record<string, unknown>) => void | Promise<void>)[]> = {};

    get apt(): AptProxy { return aptClient(this.aptTree); }

    constructor(config: Partial<typeof defaultConfig> = {}) {
        const cfg = { ...defaultConfig, ...config };
        const appPATH = cfg.appPATH.startsWith("file:") ? fromFileUrl(cfg.appPATH) : cfg.appPATH;

        this.appPATH   = ensureSlash(appPATH);
        this.basePath  = cfg.basePath;
        this.https     = cfg.https;
        this.dev       = cfg.dev;
        this.trustedProxyHops = cfg.trustedProxyHops;

        this.db        = new Db(cfg.db || `mysql:host=${cfg.dbHost};dbname=${cfg.dbName}`, cfg.dbUser, cfg.dbPass);
        this.settings  = createSettingItem(this.db).proxy;
        this.dbFiles   = new DbFileManager(this, this.appPATH + "qg/file/");
        this.dbTexts   = new DbTextManager(this);
        this.sessions  = new SessionManager(this.db);
        this.modules   = new ModuleManager(this);
        this.languages = new LangManager(this);
        this.t         = this.languages.t;
    }

    /** Web-standard entry point — `Deno.serve({}, app.fetch)`. */
    get fetch(): (req: Request, info?: { remoteAddr?: { hostname?: string } }) => Promise<Response> {
        return (req, info) => this.handle(req, this.basePath, info?.remoteAddr?.hostname);
    }

    /** Mandatory boot step, after all modules are imported: ensures the database, migrates the
     *  schema (DDL), and runs module init. Call once before serving — keeps DDL out of the request path. */
    async init(): Promise<void> {
        await this.db.ensureDatabase();  // DB must exist before migration queries run against it
        await this.modules.init();       // migrate schema (DDL) + introspect tables + module init hooks
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

    import(spec: string): Promise<Module> { return this.modules.import(spec); }

    async importAll(path: string): Promise<void> { await this.modules.importAll(path); }

    on(name: string, fn: (data: Record<string, unknown>) => void | Promise<void>): void {
        (this.#events[name] ??= []).push(fn);
    }

    async fire(name: string, data: Record<string, unknown> = {}): Promise<void> {
        if (!this.#events[name]) return;
        data["event_type"] = name;
        for (const event of this.#events[name]) await event(data);
    }

    /** The single entry point: `Request` in, `Response` out. `basePath` = the prefix this request is served under. */
    async handle(request: Request, basePath: string = this.basePath, peerAddr = ""): Promise<Response> {
        const req = new Req(request, peerAddr);
        let ctx: RequestContext, isNew: boolean;
        try {
            await this.fire("request-start", { req });           // cheap pre-filter, before any DB/session work
            [ctx, isNew] = await makeRequestContext(this, req, basePath || "/");
        } catch (e: unknown) {
            return this.#earlyError(e);
        }
        return requestStorage.run(ctx, () => this.#run(ctx, isNew));
    }

    async #run(ctx: RequestContext, isNew: boolean): Promise<Response> {
        const t0 = performance.now();
        const initialSessionToken = ctx.sessionToken;
        try {
            await this.#initRequest(ctx);
            if (isNew || ctx.sessionToken !== initialSessionToken) this.sessions.setCookie(ctx);
            await this.fire("action", { ctx });
            return await this.#route(ctx);
        } catch (e: unknown) {
            this.#handleError(ctx, e);
            return await this.#buildResponse(ctx);
        } finally {
            await ctx.cleanup();
            console.log(`${ctx.req.method} ${ctx.req.path} ${(performance.now() - t0).toFixed(1)}ms`);
        }
    }

    /** Explicit, ordered dispatch over the request path — the one routing model. */
    #route(ctx: RequestContext): Response | Promise<Response> {
        const uri = ctx.appRequestPath;

        const localPath = ctx.urlToLocalPath(ctx.req.url);
        if (localPath) return serveFile(ctx.req.raw, localPath);

        if (uri === "favicon.ico") return new Response(null, { status: 204 });

        if (uri === "dbFile" || uri.startsWith("dbFile/"))
            return this.dbFiles.output(uri.slice("dbFile/".length), ctx.req.raw);

        // apt always signals via thrown Output (success or error) — caught in #run.
        if (uri === "api" || uri.startsWith("api/"))
            return aptFetch(ctx.req, this.aptTree, uri.slice("api".length) || "/");

        return this.#renderFallback(ctx);
    }

    async #initRequest(ctx: RequestContext): Promise<void> {
        await initClient(ctx);
        await authListen(ctx);
        touchSession(ctx);
        await ctx.initSettings();
        await this.languages.initCtx(ctx);
        initLog(ctx);
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
            if (e.isJson) ctx.responseHeaders.set("Content-Type", "application/json; charset=UTF-8");
            for (const [k, v] of Object.entries(e.headers)) ctx.responseHeaders.set(k, v);
            ctx.responseBody = e.body as string;
            ctx.responseStatus = e.status;
        } else {
            console.error("Error:", e);
            ctx.responseStatus = 500;
            ctx.responseBody = "<h1>500 Internal Server Error</h1>";
        }
    }

    /** Errors raised before a request context exists (init, pre-filter, 413). */
    #earlyError(e: unknown): Response {
        if (e instanceof Output) {
            const headers = new Headers(e.headers);
            if (e.isJson) headers.set("Content-Type", "application/json; charset=UTF-8");
            return new Response(e.body as string, { status: e.status, headers });
        }
        console.error("Error:", e);
        return new Response("<h1>500 Internal Server Error</h1>", { status: 500 });
    }

    async #buildResponse(ctx: RequestContext): Promise<Response> {
        await this.fire("respond", { ctx });

        const headers = new Headers(ctx.responseHeaders);
        if (headers.has("Location")) return new Response(null, { status: ctx.responseStatus, headers });

        if (!headers.get("Cache-Control")) headers.set("Cache-Control", "no-cache, no-store");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(ctx.responseBody, { status: ctx.responseStatus, headers });
    }

}
