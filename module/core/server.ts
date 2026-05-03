// deno-lint-ignore-file no-explicit-any

import { Hono, type Context } from "hono";
import { basePath, matchedRoutes } from "hono/route";
import { fromFileUrl } from "@std/path";
import { serveDir } from "@std/http/file-server";
import type { ItemProxy } from "item/item.d.ts";

import { getCtx, makeRequestContext, requestStorage, type RequestContext } from "./lib/context.ts";
import { SessionManager } from "./lib/SessionManager.ts";
import { ensureSlash, AnswerException, RedirectException, OutputException, OutputDoneException } from "qg";
import { DB } from "./lib/db.ts";
import { DbFileManager } from "./lib/DbFileManager.ts";
import { createSettingItem } from "./lib/SettingItem.ts";
import { DbTextManager } from "./lib/DbTextManager.ts";
import { ModuleManager, type ModuleExports } from "./lib/ModuleManager.ts";
import { LangManager } from "./lib/LangManager.ts";
import { listen as siListen } from "./lib/serverInterface.ts";
import { toHono, client, type Tree } from "./lib/apt.ts";
import { initClient, initLog, touchSession } from "./lib/init.ts";
import { Auth } from "./lib/Auth.ts";

const mainDir = fromFileUrl(new URL(".", Deno.mainModule));

const defaultConfig = {
    appPATH: mainDir,
    https: false,
    dbHost: "localhost",
    dbName: "",
    dbUser: "",
    dbPass: "",
};

export type AppConfig = typeof defaultConfig;

export class App {
    config: AppConfig;
    appPATH: string;
    https: boolean;
    db: DB;
    settings: ItemProxy;
    ctxSettingsSchema: any = { properties: {} };
    dbFiles: DbFileManager;
    dbTexts: DbTextManager;
    router: Hono = new Hono();
    sessions: SessionManager;
    modules: ModuleManager;
    languages: LangManager;
    t: LangManager["t"];
    aptTree: Tree = {};
    #initPromise: Promise<void> | null = null;
    #events: Record<string, ((data: Record<string, any>) => void | Promise<void>)[]> = {};

    get apt(): any { return client(this.aptTree); }

    constructor(config: Partial<AppConfig> = {}) {
        const c = { ...defaultConfig, ...config };
        c.appPATH = ensureSlash(c.appPATH);

        this.config    = c;
        this.appPATH   = c.appPATH;
        this.https     = c.https;

        this.db        = new DB(`mysql:host=${c.dbHost};dbname=${c.dbName}`, c.dbUser, c.dbPass);
        this.settings  = createSettingItem(this.db).proxy;
        this.dbFiles   = new DbFileManager(this, this.appPATH + "qg/file/");
        this.dbTexts   = new DbTextManager(this);
        this.sessions  = new SessionManager(this.db);
        this.modules   = new ModuleManager(this);
        this.languages = new LangManager(this);
        this.t         = this.languages.t;

        this.router.onError((e, hc) => this.handleHonoError(hc, e));
        this.router.get("/favicon.ico", () => new Response(null, { status: 204 }));
        this.router.use("*", async (_hc, next) => {
            await (this.#initPromise ??= this.modules.init());
            await next();
        });
        this.router.route("/m", this.modules.router);
        this.router.use("*", (hc, next) => this.serveStatic(hc, next));
        this.router.use("*", (hc, next) => this.withRequestContext(hc, next));
        this.router.route("/dbFile", this.dbFiles.router);
        this.router.route("/api", toHono(this.aptTree));
        this.router.use("*", (hc, next) => this.handleAppFallback(hc, next));
    }

    static async create(config: Partial<AppConfig> = {}): Promise<App> {
        const app = new App(config); await app.db.init(); return app;
    }

    async import(spec: string): Promise<ModuleExports> { return await this.modules.import(spec); }

    async importAll(path: string): Promise<void> { await this.modules.importAll(path); }

    private async serveStatic(hc: Context, next: () => Promise<void>): Promise<Response | void> {
        const appURL = ensureSlash(basePath(hc));
        const appRequestUri = decodeURIComponent(hc.req.path.slice(appURL.length));

        const matchM = appRequestUri.match(/^m\/([^/]+)\/(pub|js|css)\//);
        if (matchM) {
            const modName = matchM[1];
            const mod = this.modules.get(modName);
            const fsRoot = mod?.dir ?? (this.appPATH + "m/" + modName + "/");
            return serveDir(hc.req.raw, { fsRoot, urlRoot: (appURL + "m/" + modName + "/").replace(/^\//, ""), quiet: true });
        }
        const matchQg = appRequestUri.match(/^qg\/([^/]+)\/pub\//);
        if (matchQg) {
            const modName = matchQg[1];
            const fsRoot = this.appPATH + "qg/" + modName + "/";
            return serveDir(hc.req.raw, { fsRoot, urlRoot: (appURL + "qg/" + modName + "/").replace(/^\//, ""), quiet: true });
        }
        await next();
    }

    private async withRequestContext(hc: Context, next: () => Promise<void>): Promise<Response> {
const _t0 = performance.now();
        const [ctx, isNew] = await makeRequestContext(this, hc);
        hc.set("ctx", ctx);

        return await requestStorage.run(ctx, async () => {
            try {
                await this.initRequest(ctx);
                await next();
            } catch (e: any) {
                this.handleError(ctx, e);
                hc.res = await this.buildResponse(hc, ctx);
            }
            if (isNew) this.sessions.setCookie(hc, ctx);
console.log(`${hc.req.method} ${hc.req.path} – ${(performance.now() - _t0).toFixed(1)}ms`);
            return hc.res;
        });
    }

    private async initRequest(ctx: RequestContext): Promise<void> {
        await initClient(ctx);
        await Auth.listen(ctx);
        touchSession(ctx);
        await ctx.initSettings();
        await this.languages.initCtx(ctx);
        await initLog(ctx);
    }

    private async handleAppFallback(hc: Context, next: () => Promise<void>): Promise<void> {
        await next();
        if (hc.res.status !== 404 || this.hasMatchedRoute(hc)) return;
        const ctx = getCtx();
        await this.handleAppRequest(ctx);
        hc.res = await this.buildResponse(hc, ctx);
    }

    private hasMatchedRoute(hc: Context): boolean {
        return matchedRoutes(hc).some((route) => route.path && route.path !== basePath(hc).replace(/\/$/, "") + "/*");
    }

    private async handleAppRequest(ctx: RequestContext): Promise<void> {
        await this.fire("action", { ctx });
        await siListen(ctx);
        await this.fire("render", { ctx });
        if (ctx.hasHtml) ctx.responseBody = ctx.html.render();
    }

    private handleError(ctx: RequestContext, e: any): void {
        if (e instanceof AnswerException) {
            ctx.responseHeaders.set("Content-Type", "application/json; charset=UTF-8");
            ctx.responseBody = JSON.stringify(e.data);
        } else if (e instanceof OutputException) {
            ctx.responseBody = e.body;
        } else if (!(e instanceof RedirectException || e instanceof OutputDoneException)) {
            console.error("Error:", e);
            ctx.responseStatus = 500;
            ctx.responseBody = "<h1>500 Internal Server Error</h1><pre>" + String(e) + "</pre>";
        }
    }

    private async handleHonoError(hc: Context, e: Error): Promise<Response> {
        const ctx = requestStorage.getStore();
        if (!ctx) {
            console.error("Error:", e);
            return new Response("<h1>500 Internal Server Error</h1><pre>" + String(e) + "</pre>", { status: 500 });
        }
        this.handleError(ctx, e);
        return await this.buildResponse(hc, ctx);
    }

    private async buildResponse(hc: Context, ctx: RequestContext): Promise<Response> {
        await this.fire("respond", { ctx });

        const headers = new Headers(ctx.responseHeaders);

        if (headers.has("Location")) return this.newResponse(hc, null, { status: ctx.responseStatus, headers });

        const body = String(ctx.responseBody ?? "");
        if (!headers.get("Cache-Control")) headers.set("Cache-Control", "no-cache, no-store");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.set("X-Content-Type-Options", "nosniff");
        return this.newResponse(hc, body, { status: ctx.responseStatus, headers });
    }

    private newResponse(hc: Context, body: string | ReadableStream<Uint8Array> | null, init: ResponseInit): Response {
        return hc.newResponse(body, new Response(null, init));
    }

    on(name: string, fn: (data: Record<string, any>) => void | Promise<void>): void {
        (this.#events[name] ??= []).push(fn);
    }
    async fire(name: string, data: Record<string, any> = {}): Promise<void> {
        if (!this.#events[name]) return;
        data["event_type"] = name;
        for (const event of this.#events[name]) await event(data);
    }

}
