import * as nodePath from "node:path";
import { Hono, HTTPException, fromFileUrl, serveFile, basePath, matchedRoutes, type ItemProxy, type Context } from "../../../deps.ts";
import { getCtx, makeRequestContext, requestStorage, type RequestContext } from "./RequestContext.ts";
import { SessionManager } from "./SessionManager.ts";
import { ensureSlash, Output, Redirect } from "./util.ts";
import { Db } from "./Db.ts";
import { DbFileManager } from "./DbFileManager.ts";
import { createSettingItem } from "./SettingItem.ts";
import { DbTextManager } from "./DbTextManager.ts";
import { ModuleManager, type Module } from "./ModuleManager.ts";
import { LangManager } from "./LangManager.ts";
import { toHono, aptClient, type AptTree, type AptProxy } from "./apt/mod.ts";
import { initClient, initLog, touchSession } from "./init.ts";
import { authListen } from "./auth.ts";

const mainDir:string = fromFileUrl(new URL(".", Deno.mainModule));

const defaultConfig = {
    appPATH: mainDir,
    https: false,
    dev: false,
    dbHost: "localhost",
    dbName: "",
    dbUser: "",
    dbPass: "",
};

/** The central hub of a Qino application. Manages modules, routing, database, sessions, and settings. */
export class App {
    appPATH: string;
    https: boolean;
    dev: boolean;
    db: Db;
    settings: ItemProxy;
    ctxSettingsSchema: object = { properties: {} };
    dbFiles: DbFileManager;
    dbTexts: DbTextManager;
    router: Hono = new Hono();
    sessions: SessionManager;
    modules: ModuleManager;
    languages: LangManager;
    t: LangManager["t"];
    aptTree: AptTree = {};
    #initPromise: Promise<void> | null = null;
    #events: Record<string, ((data: Record<string, unknown>) => void | Promise<void>)[]> = {};

    get apt(): AptProxy { return aptClient(this.aptTree); }

    constructor(config: Partial<typeof defaultConfig> = {}) {
        const cfg = { ...defaultConfig, ...config };
        const appPATH = cfg.appPATH.startsWith("file:") ? fromFileUrl(cfg.appPATH) : cfg.appPATH;

        this.appPATH   = ensureSlash(appPATH);
        this.https     = cfg.https;
        this.dev       = cfg.dev;

        this.db        = new Db(`mysql:host=${cfg.dbHost};dbname=${cfg.dbName}`, cfg.dbUser, cfg.dbPass);
        this.settings  = createSettingItem(this.db).proxy;
        this.dbFiles   = new DbFileManager(this, this.appPATH + "qg/file/");
        this.dbTexts   = new DbTextManager(this);
        this.sessions  = new SessionManager(this.db);
        this.modules   = new ModuleManager(this);
        this.languages = new LangManager(this);
        this.t         = this.languages.t;

        this.router.onError((e, hc) => this.#handleHonoError(hc, e));
        this.router.use("*", async (context, next) => {
            await (this.#initPromise ??= this.modules.init());
            await this.fire("request-start", { context });
            await next();
        });
        this.router.use("*", (hc, next) => this.#withRequestContext(hc, next));
        this.router.use("*", (hc, next) => this.#serveStatic(hc, next));
        this.router.route("/dbFile", this.dbFiles.router);
        this.router.route("/api", toHono(this.aptTree));
        this.router.use("*", (hc, next) => this.#handleAppFallback(hc, next));
        this.router.get("/favicon.ico", () => new Response(null, { status: 204 }));
    }

    get fetch(): (req: Request) => Response | Promise<Response> {
        return this.router.fetch.bind(this.router);
    }

    static async create(config: Partial<typeof defaultConfig> = {}): Promise<App> {
        const app = new App(config);
        await app.db.init();
        return app;
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

    async #serveStatic(hc: Context, next: () => Promise<void>): Promise<Response | void> {
        const ctx = getCtx();
        const localPath = ctx.urlToLocalPath(ctx.req.url);
        if (localPath) return serveFile(hc.req.raw, localPath);
        await next();
    }

    async #withRequestContext(hc: Context, next: () => Promise<void>): Promise<Response> {
        const t0 = Date.now();
        const [ctx, isNew] = await makeRequestContext(this, hc);
        const initialSessionToken = ctx.sessionToken;
        hc.set("ctx", ctx);

        return await requestStorage.run(ctx, async () => {
            try {
                await this.#initRequest(ctx);
                if (isNew || ctx.sessionToken !== initialSessionToken) this.sessions.setCookie(ctx);
                await this.fire("action", { ctx });
                await next();
            } catch (e: unknown) {
                this.#handleError(ctx, e);
                hc.res = await this.#buildResponse(hc, ctx);
            } finally {
                await ctx.cleanup();
console.log(`${hc.req.method} ${hc.req.path} ${Date.now() - t0}ms`);
            }
            return hc.res;
        });
    }

    async #initRequest(ctx: RequestContext): Promise<void> {
        await initClient(ctx);
        await authListen(ctx);
        touchSession(ctx);
        await ctx.initSettings();
        await this.languages.initCtx(ctx);
        initLog(ctx);
    }

    async #handleAppFallback(hc: Context, next: () => Promise<void>): Promise<void> {
        await next();
        const hasRoute = matchedRoutes(hc).some((route) => route.path && route.path !== basePath(hc).replace(/\/$/, "") + "/*");
        if (hc.res.status !== 404 || hasRoute) return;
        const ctx = getCtx();
        await this.fire("render", { ctx });
        if (ctx.hasHtml) {
            await this.fire("html-ready", { ctx });
            const html = ctx.html;
            html.lang = ctx.lang;
            html.jsData["qgToken"] = ctx.token;
            html.jsData["appURL"] = ctx.appURL || "/";
            html.jsData["sysURL"] = ctx.sysURL || "/m/";
            ctx.responseBody = html.render();
        }
        hc.res = await this.#buildResponse(hc, ctx);
    }

    #handleError(ctx: RequestContext, e: unknown): void {
        if (e instanceof Output) {
            if (e.isJson) ctx.responseHeaders.set("Content-Type", "application/json; charset=UTF-8");
            for (const [k, v] of Object.entries(e.headers)) ctx.responseHeaders.set(k, v);
            ctx.responseBody = e.body as string;
            ctx.responseStatus = e.status;
        } else if (e instanceof Redirect) {
            ctx.responseHeaders.set("Location", e.location);
            ctx.responseStatus = e.status;
        } else {
            console.error("Error:", e);
            ctx.responseStatus = 500;
            ctx.responseBody = "<h1>500 Internal Server Error</h1>";
        }
    }

    async #handleHonoError(hc: Context, e: Error): Promise<Response> {
        if (e instanceof HTTPException) return e.getResponse();
        const ctx = requestStorage.getStore();
        if (!ctx) {
            console.error("Error:", e);
            return new Response("<h1>500 Internal Server Error</h1>", { status: 500 });
        }
        this.#handleError(ctx, e);
        return this.#buildResponse(hc, ctx);
    }

    async #buildResponse(hc: Context, ctx: RequestContext): Promise<Response> {
        await this.fire("respond", { ctx });

        const headers = new Headers(ctx.responseHeaders);

        if (headers.has("Location")) return hc.newResponse(null, new Response(null, { status: ctx.responseStatus, headers }));

        const body = ctx.responseBody;
        if (!headers.get("Cache-Control")) headers.set("Cache-Control", "no-cache, no-store");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.set("X-Content-Type-Options", "nosniff");
        return hc.newResponse(body, new Response(null, { status: ctx.responseStatus, headers }));
    }

}
