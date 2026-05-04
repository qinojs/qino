/**
 * CMS.ts - CMS class
 * Port of cms/lib/cms.class.php
 */

import { hee } from "../../core/lib/util.ts"
import { getCtx } from "../../core/lib/context.ts";
import type { App } from "../../core/server.ts";
import type { Module } from "../../core/lib/ModuleManager.ts";
import type { DB } from "../../core/lib/db.ts";
import type { Node } from "./Node.ts";


function table(name: string): string { return name; }

export class CMS {
    app: App;
    db: DB
    #nodes: Map<number, Node> = new Map();
    #layouts: Record<string, string> | null = null;

    constructor(app: App) {
        this.app = app;
        this.db = app.db;
    }

    get MainNode(): Node { return getCtx().state.cmsMainPage; }
    set MainNode(v: Node) { getCtx().state.cmsMainPage = v; }
    get RequestedNode(): Node { return getCtx().state.cmsRequestedPage; }
    set RequestedNode(v: Node) { getCtx().state.cmsRequestedPage = v; }
    get RenderPath(): Set<number> { return getCtx().state.cmsRenderPath ??= new Set(); }

    async node(id = 0, vs?: Record<string, string | number>): Promise<Node> {
        id = parseInt(String(id));
        if (this.#nodes.has(id)) return this.#nodes.get(id)!;
        const { Node } = await import("./Node.ts");
        const p = new Node(this, id, vs);
        this.#nodes.set(id, p);
        if (!vs) await p.init();
        return p;
    }


    async nodesByModule(moduleName: string): Promise<Record<string, Node>> {
        const ret: Record<string, Node> = {};
        const rows = await this.db.all(`SELECT * FROM ${table("page")} WHERE module = ?`, [moduleName]);
        for (const vs of rows) {
            ret[vs.id] = await this.node(vs.id, vs);
        }
        return ret;
    }

    async nodesByName(name: string): Promise<Record<string, Node>> {
        const ret: Record<string, Node> = {};
        const rows = await this.db.all(`SELECT * FROM ${table("page")} WHERE type = 'p' AND name = ?`, [name]);
        for (const vs of rows) {
            ret[vs.id] = await this.node(vs.id, vs);
        }
        return ret;
    }

    async nodeByName(name: string): Promise<any> {
        const ret = await this.nodesByName(name);
        return Object.values(ret)[0] ?? false;
    }

    async nodeByModule(moduleName: string): Promise<any> {
        const ret = await this.nodesByModule(moduleName);
        return Object.values(ret)[0] ?? false;
    }

    async nodeFromRequest(): Promise<any> {
        const ctx = getCtx();
        const cmspid = ctx.get["cmspid"];
        let pid: number;
        if (cmspid) {
            pid = parseInt(cmspid);
        } else {
            const id = await this.db.one(`SELECT page_id FROM ${table("page_url")} WHERE url = ?`, [ctx.appRequestUri]);
            pid = parseInt(String(id ?? "0")) || 0;
        }
        return this.node(pid);
    }

    async getModules(): Promise<Record<string, Module>> {
        const modules = Object.keys(this.app.modules.all());
        modules.sort();
        const ret: Record<string, Module> = {};
        for (const module of modules) {
            if (!module.startsWith("cms.cont.")) continue;
            ret[module] = this.app.modules.get(module)!;
        }
        return ret;
    }

    async getLayouts(): Promise<Record<string, Module>> {
        const modules = Object.keys(this.app.modules.all());
        modules.sort();
        const ret: Record<string, Module> = {};
        for (const module of modules) {
            if (!module.startsWith("cms.layout.")) continue;
            ret[module] = this.app.modules.get(module)!;
        }
        return ret;
    }

    async filter(Pages: Map<number, any>, filter: any): Promise<Map<number, any>> {
        filter = Array.isArray(filter) ? filter : { ...filter };
        if (!Array.isArray(filter) && !filter.type) filter.type = "p";
        const ret: Map<number, any> = new Map();
        for (const [id, C] of Pages) {
            const vs = C.vs;
            if (!Array.isArray(filter)) {
                if (filter.type && filter.type !== "*") {
                    if (vs.type !== filter.type) continue;
                }
                if (filter.visible !== undefined) {
                    if (!!vs.visible !== !!filter.visible) continue;
                }
                if (filter.module) {
                    const modules = Array.isArray(filter.module) ? filter.module : [filter.module];
                    if (!modules.includes(vs.module)) continue;
                }
                if (filter.access !== undefined) {
                    if ((await C.access()) < filter.access) continue;
                }
            }
            if (Array.isArray(filter) && filter.includes("navi")) {
                const titleObj = await C.title();
                if (!vs.visible || !(await C.isReadable()) || !(await titleObj.string() || C.edit)) continue;
            }
            if (Array.isArray(filter) && filter.includes("access")) {
                if (!(await C.access())) continue;
            }
            if (Array.isArray(filter) && filter.includes("readable")) {
                if (!(await C.isReadable())) continue;
            }
            ret.set(id, C);
        }
        return ret;
    }

    async link(Cont: any): Promise<string> {
        const ctx = getCtx();
        const P = await this.node(parseInt(String(Cont)));
        await P.urlSeo(ctx.lang);
        const urls = await P.urls();
        const t = urls[ctx.lang]?.target;
        const target = t ? ` target="${t}"` : "";
        const title = await (await P.title()).string();
        return `<a${await this.link_attributes(P)}${target}>${title}</a>`;
    }

    async link_attributes(Cont: any): Promise<string> {
        const ctx = getCtx();
        const P = await this.node(parseInt(String(Cont)));
        await P.urlSeo(ctx.lang);
        const MainNode = this.MainNode || await this.nodeFromRequest();
        const href = ` href="${await P.url()}"`;
        const access = await P.access();
        const inside = await MainNode.in?.(P);
        const online = await P.isOnline();
        const cls = ` class="cmsLink${P} ${access ? "" : "noAccess"}${inside ? " cmsInside" : ""}${MainNode === P ? " cmsActive" : ""}${!online ? " cmsOffline" : ""}"`;
        const titleObj = await P.title();
        const cmstxt = P.edit ? ` cmstxt=${titleObj?.id ?? ""}` : "";
        const ariaCurrent = MainNode === P ? " aria-current=page" : "";
        return href + cls + cmstxt + ariaCurrent;
    }

    // deno-lint-ignore no-explicit-any
    async url(pidOrUrl: string, ret: Record<string, any> = {}): Promise<string | false> {
        pidOrUrl = pidOrUrl.trim();
        ret.target = "_blank";
        if (/^\d+$/.test(pidOrUrl)) {
            const P = await this.node(parseInt(pidOrUrl));
            if (await P.is()) {
                ret.target = "_self";
                ret.Node = P;
                return await P.url();
            }
            return false;
        }
        if (pidOrUrl === "") return false;
        if (!/^[a-z]+:/.test(pidOrUrl)) return "http://" + pidOrUrl;
        return pidOrUrl;
    }

    // deno-lint-ignore no-explicit-any
    async text(pid: any, name: string, options: Record<string, any> = {}): Promise<string> {
        const Cont = await this.node(parseInt(String(pid)));
        const T = name === "title" ? await Cont.title() : await Cont.text(name);
        const tag = options.tag ?? "div";
        if (options.contenteditable === undefined) options.contenteditable = Cont.edit;
        if (Cont.edit) {
            if (options.contenteditable === undefined) options.contenteditable = true;
            if (!options["cmstxt-placeholder"]) options["cmstxt-placeholder"] = name;
        }
        if (options.contenteditable || tag === "input" || tag === "textarea") {
            options.cmstxt = T.id;
        }
        let text = await T.string();
        if (text === "" && options.initial !== undefined) {
            if (typeof options.initial === "object" && !Array.isArray(options.initial)) {
                for (const l of this.app.languages.all) {
                    const LT = T.lang(l);
                    if ((await LT.get()) === "") await LT.set(options.initial[l] ?? "");
                }
                text = await T.string();
            } else {
                text = options.initial;
                await T.set(text); // working?
            }
        }

        const shown = name === "title" ? await Cont.showTitle() : await Cont.showText(name);
        text = String(shown);

        // if (shown.lang && shown.lang !== getCtx().lang && !("lang" in options)) {
        //     options.lang = shown.lang;
        // }

        if (options.if && !Cont.edit && !text.replace(/<[^>]*>/g, "").trim()) return "";
        delete options.if;
        delete options.tag;
        delete options.initial;
        if (tag === "textarea") delete options.contenteditable;
        if (tag === "input") { delete options.contenteditable; options.value = text; text = ""; }
        let attrStr = "";
        for (const [n, v] of Object.entries(options)) {
            if (v === false) continue;
            attrStr += v === true ? ` ${n}` : ` ${n}="${hee(v)}"`;
        }
        return `<${tag}${attrStr}>${text}</${tag}>`;
    }

    async parentFile(name: string, Cont?: any): Promise<any> {
        if (!Cont) Cont = this.MainNode || await this.nodeFromRequest();
        while (Cont) {
            const File = await Cont.FileHas(name);
            if (File) return File;
            Cont = await Cont.Parent();
        }
        return false;
    }

    async fileLang(name: string, Cont?: any, lang?: string): Promise<any> {
        if (!Cont) Cont = this.MainNode || await this.nodeFromRequest();
        if (!lang) lang = getCtx().lang;
        for (const l of Cont.app.languages.all) await Cont.File(name + " " + l);
        const file = await Cont.File(name + " " + lang);
        if (await file.exists()) return file;
        for (const l of Cont.app.languages.all) {
            const f = await Cont.File(name + " " + l);
            if (await f.exists()) return f;
        }
    }

    async parentText(name: string, Cont?: any): Promise<any> {
        if (!Cont) Cont = this.MainNode || await this.nodeFromRequest();
        while (Cont) {
            const texts = await Cont.texts();
            if (name in texts) return texts[name];
            Cont = await Cont.Parent();
        }
    }

}
