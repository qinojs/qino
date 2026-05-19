/**
 * CMS.ts - CMS class
 * Port of cms/lib/cms.class.php
 */

import { Node } from "./Node.ts";
import { hee, HtmlString } from "../../core/lib/util.ts"
import { getCtx } from "../../core/lib/RequestContext.ts";
import type { App } from "../../core/server.ts";
import type { Module } from "../../core/lib/ModuleManager.ts";
import type { Db } from "../../core/lib/Db.ts";
import type { DbFile } from "../../core/lib/DbFileManager.ts";
import type { DbText } from "../../core/lib/DbTextManager.ts";


function table(name: string): string { return name; }

export class CMS {
    app: App;
    db: Db;
    
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
        id = Number(id);
        if (this.#nodes.has(id)) return this.#nodes.get(id)!;
        const node = new Node(this, id, vs);
        this.#nodes.set(id, node);
        //if (!vs) await node.init();
        await node.init();
        return node;
    }


    async nodesByModule(moduleName: string): Promise<Record<string, Node>> {
        const ret: Record<string, Node> = {};
        const rows = await this.db.all(`SELECT * FROM ${table("page")} WHERE module = ?`, [moduleName]);
        for (const vs of rows) {
            ret[vs.id] = await this.node(vs.id, vs);
        }
        return ret;
    }

    // async nodesByName(name: string): Promise<Record<string, Node>> {
    //     const ret: Record<string, Node> = {};
    //     const rows = await this.db.all(`SELECT * FROM ${table("page")} WHERE type = 'p' AND name = ?`, [name]);
    //     for (const vs of rows) {
    //         ret[vs.id] = await this.node(vs.id, vs);
    //     }
    //     return ret;
    // }

    // async nodeByName(name: string): Promise<Node | undefined> {
    //     const ret = await this.nodesByName(name);
    //     return Object.values(ret)[0];
    // }

    async nodeByModule(moduleName: string): Promise<Node | undefined> {
        const ret = await this.nodesByModule(moduleName);
        return Object.values(ret)[0];
    }

    async nodeFromRequest(): Promise<Node> {
        const ctx = getCtx();
        const cmspid = ctx.get["cmspid"];
        let pid: number;
        if (cmspid) {
            pid = Number(cmspid);
        } else {
            const id = await this.db.one(`SELECT page_id FROM ${table("page_url")} WHERE url = ?`, [ctx.appRequestUri]);
            pid = Number(id ?? "0") || 0;
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

    // deno-lint-ignore no-explicit-any
    async filter(Pages: Map<number, Node>, filter: any): Promise<Map<number, Node>> {
        filter = Array.isArray(filter) ? filter : { ...filter };
        if (!Array.isArray(filter)) filter.type ||= "p";
        const ret: Map<number, Node> = new Map();
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

    async link(node: Node | number): Promise<HtmlString> {
        const ctx = getCtx();
        const P = await this.node(Number(node));
        await P.urlSeo(ctx.lang);
        const urls = await P.urls();
        const t = urls[ctx.lang]?.target;
        const target = t ? ` target="${t}"` : "";
        const title = await (await P.title()).string();
        return new HtmlString(`<a${await this.link_attributes(P)}${target}>${title}</a>`);
    }

    async link_attributes(node: Node | number): Promise<HtmlString> {
        const ctx = getCtx();
        const P = await this.node(Number(node));
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
        return new HtmlString(href + cls + cmstxt + ariaCurrent);
    }

    // deno-lint-ignore no-explicit-any
    async url(pidOrUrl?: string, ret: Record<string, any> = {}): Promise<string | false> {
        if (!pidOrUrl) return false;
        pidOrUrl = pidOrUrl.trim();
        ret.target = "_blank";
        if (/^\d+$/.test(pidOrUrl)) {
            const P = await this.node(Number(pidOrUrl));
            if (await P.is()) {
                ret.target = "_self";
                ret.Node = P;
                return P.url();
            }
            return false;
        }
        if (!pidOrUrl) return false;
        if (!/^[a-z]+:/.test(pidOrUrl)) return "http://" + pidOrUrl;
        return pidOrUrl;
    }
 
    // deno-lint-ignore no-explicit-any
    async text(pid: Node | number, name: string, options: Record<string, any> = {}): Promise<HtmlString | string> {
        const node = await this.node(Number(pid));
        const T = name === "title" ? await node.title() : await node.text(name);
        const tag = options.tag ?? "div";
        options.contenteditable ??= node.edit;
        if (node.edit) {
            options["cmstxt-placeholder"] ||= name;
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

        const shown = name === "title" ? await node.showTitle() : await node.showText(name);
        text = String(shown);

        // if (shown.lang && shown.lang !== getCtx().lang && !("lang" in options)) {
        //     options.lang = shown.lang;
        // }

        if (options.if && !node.edit && !text.replace(/<[^>]*>/g, "").trim()) return "";
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
        return new HtmlString(`<${tag}${attrStr}>${text}</${tag}>`);
    }

    async fileLang(node: Node, name: string, lang?: string): Promise<DbFile | undefined> {
        lang ||= getCtx().lang;
        for (const l of node.cms.app.languages.all) await node.file(name + " " + l);
        const file = await node.file(name + " " + lang);
        if (await file.exists()) return file;
        for (const l of node.cms.app.languages.all) {
            const f = await node.file(name + " " + l);
            if (await f.exists()) return f;
        }
    }

    async parentFile(node: Node, name: string): Promise<DbFile | undefined> {
        let currentNode: Node | undefined = node;
        while (currentNode) {
            const File = await currentNode.hasFile(name);
            if (File) return File;
            currentNode = await currentNode.parent();
        }
    }

    async parentText(node: Node, name: string): Promise<DbText | undefined> {
        let currentNode: Node | undefined = node;
        while (currentNode) {
            const texts = await currentNode.texts();
            if (name in texts) return texts[name];
            currentNode = await currentNode.parent();
        }
    }

}
