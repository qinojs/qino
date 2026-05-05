/**
 * Node.ts - CMS Node class
 * Port of cms/lib/Page.class.php
 */

import { hee } from "../../core/lib/util.ts"
import { getCtx } from "../../core/lib/context.ts";
import { resolveText } from "./resolveText.ts";
import { DbFile } from "../../core/lib/DbFileManager.ts";
import { $item, bildJsonItem } from "../../../deps.ts";
import type { CMS } from "./CMS.ts";
import type { App } from "../../core/server.ts";
import type { DbText, DbTextLang } from "../../core/lib/DbTextManager.ts";
import type { dbEntry_usr } from "../../core/lib/qgEntries.ts";
import type { DbEntry } from "../../core/lib/DbEntry.ts";

function table(name: string): string { return name; }

/** Node class
 * represents both "Page" (type "p") and "Cont"/"Content" (type "c") entries in the database
 */
export class Node {

    cms: CMS;
    app: App;
    db;

    id: number = 0;
    vs: Record<string, string | number> = {};

    #is: boolean = true;

    #title: DbText | null= null;
    #texts: Record<string, DbText> | null = null;
    #files: Record<string, DbFile> | null = null;
    #filesAll: Record<string, DbFile> | null = null;
    #urls: Record<string, Record<string, string>> | null = null;

    #children: Map<number, Node> | null = null;
    #named: Record<string, Record<string, Node>> = {};
    #conts: Node[] | null = null;

    constructor(cms: CMS, id = 0, vs?: Record<string, string | number>) {
        this.cms = cms;
        this.app = cms.app;
        this.db = cms.app.db;
        this.id = parseInt(String(id));
        if (vs) this.vs = vs;
    }

    async init(): Promise<this> {
        if (!this.vs || Object.keys(this.vs).length === 0) {
            this.vs = await this.db.row(`SELECT * FROM ${table("page")} WHERE id = ?`, [this.id]);
            if (!this.vs) {
                this.vs = { id: this.id, basis: 0, type: "p" };
                this.#is = false;
                return this;
            }
        } else {
            await this.app.fire("page::construct", { Page: this });
        }

        this.settings = bildJsonItem(
            this.vs.settings as string | null | undefined,
            async (json: string) => {
                this.vs = { ...this.vs, settings: json };
                await this.db.query("UPDATE page SET settings = ? WHERE id = ?", [json, this.id]);
            },
        ).proxy;

        try {
            const schema = this.module?.exports.cms?.node?.settingsSchema;
            if (schema) this.settings[$item].setSchema(schema);
        } catch {/**/}

        if (!this.vs.title_id) {
            const T = await this.app.dbTexts.generate();
            await this.set("title_id", T.id);
        }
        return this;
    }

    sql(sql: string): string { // this.app.fire("page::sql", { Page: this, sql });
        return sql;
    }

    is(): boolean { return this.#is; }

    async set(data: string | Record<string, any>, value?: any): Promise<void> {
        if (!this.#is) {
            console.warn(`Node ${this.id} does not exist! (::set)`);
            return;
        }
        if (typeof data === "string") data = { [data]: value };

        let changed = false;
        for (const [n, v] of Object.entries(data)) {
            if (this.vs[n] !== v) changed = true;
        }
        if (!changed) return;

        this.vs = { ...this.vs, ...data };
        await this.db.table("page").update(this.id, data);
    }

    // Access control
    #usrAccess: Record<number, number> = {};

    async access(user?: dbEntry_usr | null): Promise<number> {
        user ??= getCtx().user;
        const usrId = parseInt(String(user));
        this.#usrAccess[usrId] ??= await this.#calcUsrAccess(user);
        return this.#usrAccess[usrId];
    }

    async #calcUsrAccess(Usr?: dbEntry_usr | null): Promise<number> {
        if (await Usr?.get("superuser")) return 3;
        const parent = await this.parent();
        if (this.vs.access === null && parent) {
            const parentAccess = await parent.access(Usr);
            const isUser = await Usr?.is?.();
            return isUser ? Math.max(parentAccess, await this.#usrAccessOnly(Usr)) : parentAccess;
        }
        //if (!(await Usr.is())) return parseInt(this.vs.access) ? 1 : 0;
        if (!Usr) return parseInt(this.vs.access) ? 1 : 0;
        const access = Math.max(parseInt(String(this.vs.access ?? "0")), await this.#usrAccessOnly(Usr));
        if (access === 3) return 3;
        const grps = await Usr.grps?.() ?? [0];
        const placeholders = grps.map(() => "?").join(", ");
        const sql =
            " SELECT max(access) AS access " +
            " FROM page_access_grp " +
            " WHERE grp_id != 0 AND " +
            "   page_id = ? AND " +
            `   grp_id IN(${placeholders}) `;
        const grpAccess = parseInt(String(await this.db.one(sql, [this.id, ...grps]) ?? "0")) || 0;
        return Math.max(access, grpAccess);
    }

    async #usrAccessOnly(Usr?: dbEntry_usr | null): Promise<number> {
        const sql = " SELECT access FROM page_access_usr WHERE page_id = ? AND usr_id = ? ";
        return parseInt(String(await this.db.one(sql, [this.id, String(Usr)]) ?? "0")) || 0;
    }

    /* Render */
    async html(vars: Record<string, any> = {}): Promise<string> {
        if (!(await this.isReadable())) return "";
        const ctx = getCtx();
        const renderPath: Set<number> = ctx.state.cmsRenderPath ??= new Set();
        if (renderPath.has(this.id)) {
            return this.edit ? `<div class="qgCmsCont -pid${this}">Recursion, Content ${this.id} again!</div>` : "";
        }
        renderPath.add(this.id);

        // Add CSS for module
        try {
            await Deno.stat(this.app.appPATH + "qg/" + this.vs.module + "/pub/main.css");
            ctx.html.addCSSFile(ctx.appURL + "qg/" + this.vs.module + "/pub/main.css");
        } catch {/**/}

        const s = await this.htmlPrepared(vars);

        const modDir = this.module?.dir;

        if (modDir) try {
            await Deno.stat(modDir + "pub/main.js");
            ctx.html.addJSM(ctx.sysURL + this.vs.module + "/pub/main.js");
        } catch {/**/}

        if (modDir) try {
            await Deno.stat(modDir + "pub/main.css");
            ctx.html.addCSSFile(ctx.appURL + "m/" + this.vs.module + "/pub/main.css");
        } catch {/**/}

        renderPath.delete(this.id);
        return s;
    }

    async htmlPrepared(vars: Record<string, any> = {}): Promise<string> {
        const ctx = getCtx();

        let str = (await this.htmlRaw(vars) ?? "").trim();
        if (!str) str = "<div></div>";

        const type = this.vs.type === "c" ? "Cont" : "Page";
        let cls = `qgCms${type} -pid${this.id} -m-${this.vs.module?.replace(/\./g, "-")}`;

        if (this.edit) {
            cls += " -e";
            if (this.vs.module?.startsWith("cms.cont.flexible")) cls += " qgCMS-dropTarget";
            if (!(await this.isOnline())) cls += " qgCMS-offline";
        }

        let attr = "";
        if (this.vs.type === "c" && this.vs.visible) {
            attr = ` id="${hee((await this.urlSeo(ctx.lang)).slice(1))}"`;
        }
        if (this.vs.name) attr += ` vcms-name="${hee(this.vs.name)}"`;

        // Try to inject class into first HTML element
        const ret1 = str.replace(/^<([^>]+)class=("([^"]*)"|([^\s>]*))/, `<$1class="$3$4 ${cls}"${attr}`);
        if (ret1 !== str) return ret1;
        const ret2 = str.replace(/^<([^\s>]+)([\s]?)/, `<$1 class="${cls}"${attr}$2`);
        if (ret2 !== str) return ret2;
        return `<div class="${cls}"${attr}>${str}</div>`;
    }

    async htmlRaw(vars: Record<string, any> = {}): Promise<string | undefined> {
        if (!this.#is) { console.warn("Seite existiert nicht!"); return undefined; }

        try {
            if (!this.module) throw new Error(`Module "${this.vs.module}" is not imported`);
            return await this.module.exports.cms.node.render(this, {ctx:getCtx(), vars});
        } catch (err: any) {
            console.error(`Error in module "${this.vs.module}": ${err.message}`, err);
            return this.edit ? `<div>Webmaster: das Modul ist Fehlerhaft! <code>${err.message}</code></div>` : '<div></div>';
        }
    }

    async htmlPart(part: string, vars: Record<string, any> = {}): Promise<string | false> {
        if (/[/\\]/.test(part)) return false;
        const parts = this.module?.exports.cms?.node?.parts ?? {};
        const fn = Object.hasOwn(parts, part) && typeof parts[part] === "function" ? parts[part] : false;
        if (!fn) return false;

        try {
            return await fn(this, {ctx:getCtx(), vars});
        } catch (err: any) {
            console.error(`Error in module "${this.vs.module}": ${err.message}`, err);
            return this.edit ? `<div>Webmaster: das Modul ist Fehlerhaft! <code>${err.message}</code></div>` : '<div></div>';
        }
    }

    get module() {
        return this.app.modules.get(String(this.vs.module ?? ""));
    }
    /* Online state */
    async onlineStart(): Promise<number> {
        const p = await this.parent();
        return this.vs.online_start === null && p ? p.onlineStart() : parseInt(String(this.vs.online_start ?? "0"));
    }
    async onlineEnd(): Promise<number> {
        const p = await this.parent();
        return this.vs.online_end === null && p ? p.onlineEnd() : parseInt(String(this.vs.online_end ?? "0"));
    }
    async isOnline(): Promise<boolean> {
        const start = await this.onlineStart();
        const end = await this.onlineEnd();
        const now = Math.floor(Date.now() / 1000) + 32;
        return (start === 0 || now > start) && (end === 0 || now < end);
    }
    async isReadable(): Promise<boolean> {
        return this.edit || ((await this.access()) > 0 && (await this.isOnline()));
    }
    async isPublic(): Promise<boolean> {
        const p = await this.parent();
        return this.vs.access === null && p ? p.isPublic() : !!this.vs.access;
    }
    async accessInheritParent(): Promise<Node> {
        const p = await this.parent();
        return this.vs.access === null && p ? p.accessInheritParent() : this;
    }

    get edit(): boolean {
        const ctx = getCtx();
        const usrId = parseInt(String(ctx.user));
        const cachedAccess = this.#usrAccess[usrId] ?? 0;
        return cachedAccess > 1 && !!ctx.state.editmode;
    }

    async page(): Promise<Node> {
        const parent = await this.parent();
        return this.vs.type === "p" || !parent ? this : await parent.page();
    }

    settings: any = {};

    get modUrl(): string { return getCtx().sysURL + this.vs.module + "/"; }

    /* Tree traversal */
    async children(filter?: any): Promise<Map<number, Node>> {
        //await this.app.fire("page::children", { Page: this });
        if (this.#children === null) {
            this.#children = new Map();
            const rows = await this.db.all(`SELECT * FROM ${table("page")} WHERE basis = ? ORDER BY type DESC, sort, id DESC`, [this.id]);
            for (const row of rows) {
                const id = parseInt(row.id);
                const Child = await this.cms.node(id, row);
                await Child.init();
                this.#children.set(id, Child);
                if (row.name) {
                    this.#named[row.type] ??= {};
                    this.#named[row.type][row.name] = Child;
                }
            }
        }
        if (filter) return this.cms.filter(this.#children, filter);
        return this.#children;
    }

    async conts(): Promise<Node[]> {
        return this.#conts ??= [...(await this.children({ type: "c" })).values()];
    }

    async parent(level?: number): Promise<Node | false> {
        const parent = this.vs.basis ? await this.cms.node(this.vs.basis) : false;
        if (level === undefined) return parent;
        const path = await this.path();
        let i = 0;
        for (const P of path.values()) if (i++ === level) return P;
        return false;
    }

    async path(): Promise<Map<number, Node>> {
        const parent = await this.parent();
        const path = parent ? new Map(await parent.path()) : new Map();
        path.set(this.id, this);
        return path;
    }

    async bough(filter?: any): Promise<Map<number, Node>> {
        const bough: Map<number, Node> = new Map([[this.id, this]]);
        for (const Child of (await this.children({ type: "*" })).values()) {
            for (const [k, v] of (await Child.bough()).entries()) bough.set(k, v);
        }
        return filter ? this.cms.filter(bough, filter) : bough;
    }

    async in(PageRef: Node | number): Promise<boolean> {
        const path = await this.path();
        return path.has(parseInt(String(PageRef)));
    }

    /* Texts */

    async #showTextLang(textOrLang: any, lang?: string | null): Promise<any> {
        const ctx = getCtx();
        const textLang = lang == null ? await textOrLang.orFallback(ctx.lang) : textOrLang;
        const raw = await textLang.get();
        const value = this.edit ? raw : await resolveText(this.app, raw);
        return {
            lang: textLang.lang,
            id: textLang.Text.id,
            toString() { return value; },
        };
    }

    async showText(name = "main", lang?: string | null): Promise<any> {
        const obj = await this.text(name, lang ?? null);
        return this.#showTextLang(obj, lang);
    }

    async showTitle(lang?: string | null): Promise<any> {
        const obj = await this.title(lang);
        return this.#showTextLang(obj, lang);
    }

    async texts(): Promise<Record<string, any>> {
        if (this.#texts === null) {
            const rows = await this.db.indexCol(this.sql(`SELECT name, text_id FROM ${table("page_text")} WHERE page_id = ?`), [this.id]);
            this.#texts = {};
            for (const [name, id] of Object.entries(rows ?? {})) {
                const T = this.app.dbTexts.text(parseInt(String(id)));
                this.#texts[name] = T;
            }
        }
        return this.#texts;
    }

    async text(name?: string): Promise<DbText>;
    async text(name: string, lang: string | null): Promise<DbTextLang>;
    async text(name: string, lang: string | null, value: any): Promise<false | undefined>;
    async text(name = "main", lang?: string | null, value?: any): Promise<DbText | DbTextLang | undefined | false> {
        const texts = await this.texts();
        if (!(name in texts)) {
            const T = await this.app.dbTexts.generate();
            await this.db.table("page_text").insert({ name, page_id: String(this), text_id: T.id });
            texts[name] = T;
        }
        if (lang == null) return texts[name];
        const textLang = await texts[name].lang(lang);
        if (value === undefined) return textLang;
        if ((await textLang.get()) === value) return false;
        await textLang.set(value);
    }

    async textDelete(name: string): Promise<void> {
        const texts = await this.texts();
        if (!texts[name]) return;
        await this.db.table("text").delete(texts[name].id);
        delete texts[name];
    }

    async title(lang?: string | null, value?: any): Promise<any> {
        this.#title ??= this.app.dbTexts.text(parseInt(String(this.vs.title_id ?? "0")));
        if (lang == null) return this.#title;
        const TextLang = await this.#title.lang(lang);
        if (value === undefined) return TextLang.get();
        if ((await TextLang.get()) === value) return false;
        await TextLang.set(value);
        await this.urlsSeoGen();
    }

    /* Files */
    async files(): Promise<Record<string, DbFile>> {
        if (this.#files === null) {
            this.#files = {};
            this.#filesAll = {};
            const sql =
                " SELECT f.*, pf.name as pf_name " +
                " FROM " +
                `   ${table("page_file")} pf ` +
                `   LEFT JOIN ${table("file")} f ON f.id = pf.file_id ` +
                " WHERE pf.page_id = ? " +
                " ORDER BY sort ";
            const rows = await this.db.all(this.sql(sql), [this.id]);
            for (const vs of rows) {
                const F = this.app.dbFiles.file(vs.id, vs);
                this.#filesAll[vs.pf_name] = F;
                if (await F.exists()) this.#files[vs.pf_name] = F;
            }
        }
        return this.#files;
    }

    async filesAndPlaceholders(): Promise<Record<string, any>> {
        await this.files();
        return this.#filesAll!;
    }

    async file(name: string): Promise<DbFile> {
        await this.files();
        if (!(name in this.#filesAll!)) return this.addFile(undefined, name);
        return this.#filesAll![name];
    }

    async addFile(file?: DbFile | string, name?: string): Promise<DbFile> {

        const File = file instanceof DbFile ? file : await this.app.dbFiles.add(file);

        const row: Record<string, any> = { page_id: String(this), file_id: String(File) };
        if (!name) {
            const minSort = await this.db.one(this.sql("SELECT min(sort) FROM page_file WHERE page_id = ?"), [this.id]);
            row.sort = (parseInt(String(minSort ?? "0")) || 0) - 1;
            name = "_" + Math.random().toString(36).slice(2, 9);
        }
        row.name = name;
        await this.db.table("page_file").ensure(row);
        this.#files = null;
        return File;
    }

    async deleteFile(name: string): Promise<boolean> {
        await this.files();
        if (!this.#filesAll![name]) return false;
        const dbFileEntry = this.#filesAll![name];
        await this.db.table("page_file").delete({ page_id: String(this), name });
        const used = await dbFileEntry.used?.();
        if (!used) await dbFileEntry.remove?.();
        delete this.#files![name];
        delete this.#filesAll![name];
        return true;
    }

    async hasFile(name: string): Promise<DbFile | undefined> {
        await this.files();
        return this.#files?.[name];
    }

    async sortFiles(sort: string[]): Promise<void> {  // todo, security: just existing files allowed!
        let i = 1;
        for (const file of sort) {
            await this.db.table("page_file").update({ page_id: String(this), name: file, sort: i++ });
        }
        this.#files = null;
    }

    /* URLs */
    async urls(): Promise<Record<string, any>> {
        if (this.#urls === null) {
            this.#urls = {};
            const rows = await this.db.all(this.sql(`SELECT lang, url, target FROM ${table("page_url")} WHERE page_id = ?`), [this.id]);
            for (const row of rows) this.#urls[row.lang] = row;
        }
        return this.#urls;
    }

    async url(lang?: string): Promise<string> {
        const ctx = getCtx();
        lang ??= ctx.lang;
        const hash = this.vs.type === "c" ? await this.urlSeo(lang) : "";
        if (this.edit) return ctx.appURL + "?cmspid=" + await this.page() + "&changeLanguage=" + lang + hash;
        return ctx.appURL + (await (await this.page()).urlSeo(lang)) + hash;
    }

    async urlSeo(lang: string): Promise<string> {
        const urls = await this.urls();
        urls[lang] ??= { url: await this.urlSeoGen(lang), target: "" };
        return urls[lang].url;
    }

    async urlSet(lang: string, data: Record<string, any>): Promise<void> {
        data = { page_id: this.id, lang, ...data };
        const row = await this.db.row(this.sql("SELECT * FROM page_url WHERE page_id = ? AND lang = ?"), [this.id, lang]);
        await this.db.table("page_url")[row ? "update" : "insert"](data);
    }

    async urlSeoGenerated(lang: string): Promise<string> {
        if (this.vs.type === "c") return "#cmspid" + this;
        const parent = await this.parent();
        const parentUrl = !parent || String(parent) === "1" ? lang : await parent.urlSeo(lang);
        const { urlize } = await import("../../core/lib/util.ts");
        const titleT = await this.title();
        const titleStr = titleT ? await titleT.orFallback(lang).then((t: any) => t.get()) ?? "" : "";
        const part = urlize(titleStr);
        const base = parentUrl === "" || parentUrl.endsWith("/") ? parentUrl : parentUrl + "/";
        let url = base + part;
        const exists = await this.db.one(this.sql("SELECT page_id FROM page_url WHERE url = ? AND NOT (page_id = ? AND lang = ?)"), [url, this.id, lang]);
        if ((await Deno.stat(this.app.appPATH + url).catch(() => null)) || exists) {
            url += "-" + lang + this;
        }
        return url;
    }

    async urlSeoGen(lang: string): Promise<string> {
        const row = await this.db.row(this.sql("SELECT * FROM page_url WHERE page_id = ? AND lang = ?"), [this.id, lang]);
        const url = row?.custom ? row.url : await this.urlSeoGenerated(lang);
        await this.urlSet(lang, { url });
        for (const C of (await this.children({ type: "*" })).values()) {
            await C.urlSeoGen(lang);
        }
        return url;
    }

    async urlsSeoGen(): Promise<void> {
        for (const l of this.cms.app.languages.all) {
            await this.urlSeoGen(l);
        }
    }

    /* Tree manipulation */
    async createChild(vs: Record<string, any> = {}): Promise<Node> {
        vs = {
            basis: this.id,
            online_start: Math.floor(Date.now() / 1000),
            access: this.vs.access,
            module: this.vs.module,
            searchable: this.vs.searchable,
            type: "p",
            visible: 1,
            ...vs,
        };
        const id = await this.db.table("page").insert(vs);
        const P = await this.cms.node(parseInt(String(id ?? "0")));
        await P.init();
        if (!id) return P;

        const accessUsrs = await this.db.all("SELECT * FROM page_access_usr WHERE page_id = ?", [this.id]);
        for (const data of accessUsrs) await this.db.table("page_access_usr").insert({ ...data, page_id: String(P) });
        const accessGrps = await this.db.all("SELECT * FROM page_access_grp WHERE page_id = ?", [this.id]);
        for (const data of accessGrps) await this.db.table("page_access_grp").insert({ ...data, page_id: String(P) });

        await P.texts();
        await P.files();

        // Re-sort children so the new child gets a proper sort position
        this.#children = this.#conts = null;
        this.#named = {};
        let i = 0;
        for (const C of (await this.children({ type: vs.type })).values()) {
            await C.set("sort", ++i);
        }

        return P;
    }

    createCont(vs: Record<string, string | number | boolean | null> = {}): Promise<Node> {
        vs = { type: "c", module: "cms.cont.flexible", visible: "", online_start: null, access: null, ...vs };
        return this.createChild(vs);
    }

    async copy(deep = false, ifFn?: (p: Node) => Promise<boolean | void> | boolean | void): Promise<Node | false> {
        if (await ifFn?.(this) === false) return false;

        const row: Record<string, any> = { ...this.vs };
        delete row["id"];
        const newId = parseInt(String(await this.db.table("page").insert(row) ?? "0"));
        if (!newId) return false;
        const P = await this.cms.node(newId);
        await P.init();

        const titleCopy = await (await this.title())!.copy();
        const ctx = getCtx();
        await P.set({ log_id: ctx.logId ?? null, title_id: titleCopy.id, _cache: "" });
        P.#title = titleCopy;

        const texts = await this.texts();
        for (const [name, Text] of Object.entries(texts)) {
            const textCopy = await Text.copy();
            await this.db.table("page_text").insert({ page_id: newId, text_id: textCopy.id, name });
        }
        P.#texts = null;

        const old2new: Record<string, string> = {};
        const files = await this.files();
        for (const [name, file] of Object.entries(files)) {
            const newFile = await file.clone();
            old2new[String(file.id)] = String(newFile.id);
            await this.db.table("page_file").insert({ page_id: newId, file_id: newFile.id, name });
        }
        P.#files = null;
        P.#filesAll = null;

        if (Object.keys(old2new).length) {
            const newTexts = await P.texts();
            for (const [, Text] of Object.entries(newTexts)) {
                for (const l of this.app.languages.all) {
                    const tl = Text.lang(l);
                    let text = await tl.get();
                    for (const [oldId, newFileId] of Object.entries(old2new)) {
                        text = text.replaceAll(`/dbFile/${oldId}/`, `/dbFile/${newFileId}/`);
                    }
                    await tl.set(text);
                }
            }
        }

        for (const Cont of (await this.children({ type: deep ? "*" : "c" })).values()) {
            const Copy = await Cont.copy(deep, ifFn);
            if (Copy) await Copy.set("basis", newId);
        }

        P.#children = P.#conts = null;

        const parent = await this.parent();
        if (parent) parent.#children = parent.#conts = null;
        
        return P;
    }

    async insertBefore(PageArg: Node | number, Before?: Node | number | null): Promise<boolean> {
        const P = await this.cms.node(parseInt(String(PageArg)));
        const OldParent = await P.parent();
        const BeforePage = Before ? await this.cms.node(parseInt(String(Before))) : null;
        if (await this.in(P)) return false;
        const type = P.vs.type;

        let sort: number | null = null;
        let i = 1;
        for (const Child of (await this.children({ type })).values()) {
            if (String(P) === String(Child)) continue;
            if (BeforePage && String(BeforePage) === String(Child)) sort = i++;
            await Child.set("sort", i++);
        }
        sort = sort !== null ? sort : i++;
        await P.set({ basis: this.id, sort });

        this.#children = this.#conts = null;
        this.#named = {};

        if (OldParent) {
            OldParent.#children = OldParent.#conts = null;
            OldParent.#named = {};
        }

        await P.urlsSeoGen();
        return true;
    }

    async removeChild(Child: Node | number): Promise<boolean> {
        const P = await this.cms.node(parseInt(String(Child)));
        const children = await this.children({ type: "*" });
        if (!children.has(parseInt(String(P)))) return false;
        for (const C of (await P.children({ type: "*" })).values()) await P.removeChild(C);
        for (const name of Object.keys(await P.files())) await P.deleteFile(name);
        for (const name of Object.keys(await P.texts())) await P.textDelete(name);
        await this.db.table("page").delete(String(P));
        this.#children = this.#conts = null;
        this.#named = {};
        return true;
    }

    async cont(name: string, attris: any = {}): Promise<Node> {
        const conts = await this.conts();
        this.#named["c"] ??= {};
        if (!this.#named["c"][name]) {
            if (typeof attris !== "object") attris = { module: attris };
            attris.name = name;
            attris.sort = conts.length + 1;
            this.#named["c"][name] = await this.createCont(attris);
        }
        return this.#named["c"][name];
    }
    
    // named sub-page, created if not exists, needed?
    // async subPage(name: string, attris: any = {}): Promise<Node> {
    //     await this.children();
    //     if (this.#named["p"]?.[name]) return this.#named["p"][name];
    //     if (typeof attris !== "object") attris = { module: attris };
    //     attris.name = name;
    //     return this.createChild(attris);
    // }

    /* Access */
    async changeUser(user: dbEntry_usr | number, access: number): Promise<this> {
        const vs = { page_id: String(this), usr_id: String(user), access };
        if (!access) await this.db.table("page_access_usr").delete(vs);
        else await this.db.table("page_access_usr").ensure(vs);
        return this;
    }
    async changeGroup(grp: DbEntry | number, access: number): Promise<this> {
        const vs = { page_id: String(this), grp_id: String(grp), access };
        if (!access) await this.db.table("page_access_grp").delete(vs);
        else await this.db.table("page_access_grp").ensure(vs);
        return this;
    }

    toString(): string { return String(this.id); }

}
