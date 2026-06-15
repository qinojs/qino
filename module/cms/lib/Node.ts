import { resolveText } from "./resolveText.ts";
import { parseXml, type XmlNode } from "./parseXml.ts";
import { hee, HtmlString, getCtx, urlize, tableRef, DbFile, type DbText, type DbTextLang, type dbEntry_usr, type DbEntry } from "../../core/mod.ts";
import { $item, bildJsonItem } from "../../../deps.ts";
import type { CMS } from "./CMS.ts";

/** Node class
 * represents both "Page" (type "p") and "Cont"/"Content" (type "c") entries in the database
 */
export class Node {

    cms: CMS;
    app: CMS["app"];
    db: CMS["app"]["db"];

    id: number = 0;
    vs: Record<string, string | number | null> = {};

    #is: boolean = true;

    #title: DbText | null= null;
    #texts: Record<string, DbText> | null = null;
    #files: Promise<Record<string, DbFile>> | null = null;
    #filesAll: Record<string, DbFile> | null = null;
    #urls: Record<string, Record<string, string>> | null = null;

    #children: Promise<Map<number, Node>> | null = null;
    #named: Record<string, Record<string, Node>> = {};
    #conts: Node[] | null = null;

    constructor(cms: CMS, id = 0, vs?: Record<string, string | number>) {
        this.cms = cms;
        this.app = cms.app;
        this.db = cms.app.db;
        this.id = Number(id);
        if (vs) this.vs = vs;
    }

    async init(): Promise<this> {
        if (!this.vs || !Object.keys(this.vs).length) {
            const row = await this.db.row(`SELECT * FROM ${tableRef("page")} WHERE id = ?`, [this.id]);
            if (!row) {
                this.vs = { id: this.id, basis: 0, type: "p" };
                this.#is = false;
                return this;
            }
            this.vs = row;
        } else {
            await this.app.fire("page::construct", { Page: this });
        }

        this.settings = bildJsonItem(
            this.vs.settings as string | null | undefined,
            async (json: string) => {
                this.vs = { ...this.vs, settings: json };
                await this.db.table("page").update(this.id, { settings: json });
            },
        ).proxy;

        try {
            const schema = this.module?.plugin.cms?.node?.settingsSchema;
            if (schema) this.settings[$item].setSchema(schema);
        } catch {/**/}

        if (!this.vs.title_id) {
            const T = await this.app.dbTexts.generate();
            await this.set("title_id", T.id);
        }
        return this;
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
    async access(user?: dbEntry_usr | null): Promise<number> {
        const ctx = getCtx();
        user ??= ctx.user;
        const usrId = Number(user);
        const cache = ctx.cms.accessCache;
        const key = `${this.id}:${usrId}`;
        cache[key] ??= await this.#calcUsrAccess(user);
        return cache[key];
    }

    async #calcUsrAccess(Usr?: dbEntry_usr | null): Promise<number> {
        if (await Usr?.get("superuser")) return 3;
        const parent = await this.parent();
        if (this.vs.access === null && parent) {
            const parentAccess = await parent.access(Usr);
            const isUser = await Usr?.is?.();
            return isUser ? Math.max(parentAccess, await this.#usrAccessOnly(Usr)) : parentAccess;
        }

        if (!Usr) return Number(this.vs.access ?? "0") ? 1 : 0;
        const access = Math.max(Number(this.vs.access ?? "0"), await this.#usrAccessOnly(Usr));
        if (access === 3) return 3;
        const grps = await Usr.grps?.() ?? [0];
        const placeholders = grps.map(() => "?").join(", ");
        const sql =
            " SELECT max(access) AS access " +
            " FROM page_access_grp " +
            " WHERE grp_id != 0 AND " +
            "   page_id = ? AND " +
            `   grp_id IN(${placeholders}) `;
        const grpAccess = Number(await this.db.one(sql, [this.id, ...grps]) ?? "0") || 0;
        return Math.max(access, grpAccess);
    }

    async #usrAccessOnly(Usr?: dbEntry_usr | null): Promise<number> {
        const sql = " SELECT access FROM page_access_usr WHERE page_id = ? AND usr_id = ? ";
        return Number(await this.db.one(sql, [this.id, String(Usr)]) ?? "0") || 0;
    }

    /* Render */
    async html(vars: Record<string, any> = {}): Promise<HtmlString> {
        if (!(await this.isReadable())) return new HtmlString("");
        const ctx = getCtx();
        const renderPath = ctx.cms.renderPath;
        if (renderPath.has(this.id)) {
            return new HtmlString(this.edit ? `<div qcms-id=${this.id}>Recursion, Content ${this.id} again!</div>` : "");
        }
        renderPath.add(this.id);

        const mod = this.module;
        const nodeExports = mod?.plugin.cms?.node;
        const modBase = ctx.appURL + "m/" + this.vs.module + "/";
        const isAbsolute = (f: string) => f.startsWith("http://") || f.startsWith("https://") || f.startsWith("/");
        for (const file of nodeExports?.css ?? []) ctx.html.styles.add(isAbsolute(file) ? file : modBase + file);
        for (const file of nodeExports?.js ?? [])  ctx.html.scripts.add(isAbsolute(file) ? file : modBase + file);

        const s = await this.htmlPrepared(vars);

        renderPath.delete(this.id);
        return s;
    }


    // Todo: generate something like this
    // <div qcms-id=170 qcms-mod="cont.text" qcms-name="main" qcms-drop qcms-edit qcms-offline>

    async htmlPrepared(vars: Record<string, any> = {}): Promise<HtmlString> {
        const ctx = getCtx();

        let str = (await this.htmlRaw(vars) ?? "").trim();
        str ||= "<div></div>";

        let attr = "";

        const moduleName = this.module?.name ?? "";
        attr += ` qcms-id=${this.id} qcms-mod="${hee(moduleName.replace(/^cms\./, ""))}"`;

        if (this.edit) {
            attr += " qcms-edit";
            if (moduleName.startsWith("cms.cont.flexible")) attr += " qcms-drop";
            if (!(await this.isOnline())) attr += " qcms-offline";
        }

        if (this.vs.type === "c" && this.vs.visible) {
            attr += ` id="${hee((await this.urlSeo(ctx.lang)).slice(1))}"`;
        }
        if (this.vs.name) attr += ` qcms-name="${hee(this.vs.name)}"`;

        const ret2 = str.replace(/^<([^\s>]+)([\s]?)/, `<$1${attr}$2`);
        if (ret2 !== str) return new HtmlString(ret2);
        return new HtmlString(`<div${attr}>${str}</div>`);
    }

    async htmlRaw(vars: Record<string, any> = {}): Promise<string | undefined> {
        if (!this.#is) { console.warn("Page does not exist!"); return undefined; }

        try {
            if (!this.module) throw new Error(`Module "${this.vs.module}" is not imported`);
            let render = this.module.plugin.cms?.node?.render;
            if (!render) {
                const e: { node: Node; render: ((node: Node, opts: Record<string, unknown>) => unknown) | null } = { node: this, render: null };
                await this.app.fire("cms.node.render", e);
                render = e.render ?? undefined;
            }
            if (!render) throw new Error(`No render function for module "${this.vs.module}"`);
            return String(await render(this, {ctx:getCtx(), vars}));
        } catch (err: any) {
            console.error(`Error in module "${this.vs.module}": ${err.message}`, err);
            return this.edit ? `<div>Webmaster: ${await this.app.t`module error!`} <code>${err.message}</code></div>` : '<div></div>';
        }
    }

    async htmlPart(part: string, vars: Record<string, any> = {}): Promise<HtmlString | false> {
        if (/[/\\]/.test(part)) return false;
        const parts = this.module?.plugin.cms?.node?.parts ?? {};
        const fn = Object.hasOwn(parts, part) && typeof parts[part] === "function" ? parts[part] : false;
        if (!fn) return false;

        try {
            return new HtmlString(String(await fn(this, {ctx:getCtx(), vars})));
        } catch (err: any) {
            console.error(`Error in module "${this.vs.module}": ${err.message}`, err);
            return new HtmlString(this.edit ? `<div>Webmaster: module error! <code>${err.message}</code></div>` : '<div></div>');
        }
    }

    get module() {
        return this.app.modules.get(String(this.vs.module ?? ""));
    }
    /* Online state */
    async onlineStart(): Promise<number> {
        const p = await this.parent();
        return this.vs.online_start === null && p ? p.onlineStart() : Number(this.vs.online_start ?? "0");
    }
    async onlineEnd(): Promise<number> {
        const p = await this.parent();
        return this.vs.online_end === null && p ? p.onlineEnd() : Number(this.vs.online_end ?? "0");
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
        const usrId = Number(ctx.user);
        const cache = ctx.cms.accessCache;
        const cachedAccess = cache[`${this.id}:${usrId}`] ?? 0;
        return cachedAccess > 1 && !!ctx.cms.editmode;
    }

    async page(): Promise<Node> {
        const parent = await this.parent();
        return this.vs.type === "p" || !parent ? this : await parent.page();
    }

    settings: any = {};

    get modUrl(): string { return getCtx().sysURL + this.vs.module + "/"; }

    /* Tree traversal */
    children(filter?: any): Promise<Map<number, Node>> {
        this.#children ??= (async () => {
            const map: Map<number, Node> = new Map();
            const rows = await this.db.all(`SELECT * FROM ${tableRef("page")} WHERE basis = ? ORDER BY type DESC, sort, id DESC`, [this.id]);
            for (const row of rows) {
                const id = Number(row.id);
                const Child = await this.cms.node(id, row);
                map.set(id, Child);
                if (row.name) {
                    this.#named[row.type] ??= {};
                    this.#named[row.type][row.name] = Child;
                }
            }
            return map;
        })();
        if (filter) return this.#children.then((map) => this.cms.filter(map, filter));
        return this.#children;
    }

    async conts(): Promise<Node[]> {
        return this.#conts ??= [...(await this.children({ type: "c" })).values()];
    }

    async parent(level?: number): Promise<Node | undefined> {
        const parent = this.vs.basis ? await this.cms.node(Number(this.vs.basis)) : undefined;
        if (level === undefined) return parent;
        const path = await this.path();
        let i = 0;
        for (const P of path.values()) if (i++ === level) return P;
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
        return path.has(Number(PageRef));
    }

    /* Texts */

    async #showTextLang(textOrLang: any, lang?: string | null): Promise<any> {
        const ctx = getCtx();
        const textLang = lang == null ? await textOrLang.orFallback(ctx.lang) : textOrLang;
        const raw = await textLang.get();
        const value = this.edit ? raw : await resolveText(this.app, raw);
        return {
            lang: textLang.lang,
            id: textLang.text.id,
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
            const rows = await this.db.indexCol(`SELECT name, text_id FROM ${tableRef("page_text")} WHERE page_id = ?`, [this.id]);
            this.#texts = {};
            for (const [name, id] of Object.entries(rows ?? {})) {
                const T = this.app.dbTexts.text(Number(id));
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
        this.#title ??= this.app.dbTexts.text(Number(this.vs.title_id ?? "0"));
        if (lang == null) return this.#title;
        const TextLang = await this.#title.lang(lang);
        if (value === undefined) return TextLang.get();
        if ((await TextLang.get()) === value) return false;
        await TextLang.set(value);
        await this.urlsSeoGen();
    }

    /* Files */
    files(): Promise<Record<string, DbFile>> {
        if (!this.#files) {
            this.#filesAll = {};
            this.#files = (async () => {
                const files: Record<string, DbFile> = {};
                const sql =
                    " SELECT f.*, pf.name as pf_name " +
                    " FROM " +
                    `   ${tableRef("page_file")} pf ` +
                    `   LEFT JOIN ${tableRef("file")} f ON f.id = pf.file_id ` +
                    " WHERE pf.page_id = ? " +
                    " ORDER BY sort ";
                const rows = await this.db.all(sql, [this.id]);
                for (const vs of rows) {
                    const F = await this.app.dbFiles.file(vs.id, vs);
                    this.#filesAll![vs.pf_name] = F;
                    if (await F.exists()) files[vs.pf_name] = F;
                }
                return files;
            })();
        }
        return this.#files;
    }

    async filesAndPlaceholders(): Promise<Record<string, DbFile>> {
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

        const row: Record<string, string | number> = { page_id: String(this), file_id: String(File) };
        if (!name) {
            const minSort = await this.db.one(`SELECT min(sort) FROM ${tableRef("page_file")} WHERE page_id = ?`, [this.id]);
            row.sort = (Number(minSort ?? "0") || 0) - 1;
            name = "_" + Math.random().toString(36).slice(2, 9);
        }
        row.name = name;
        await this.db.table("page_file").ensure(row);
        this.#files = null; this.#filesAll = null;
        return File;
    }

    async deleteFile(name: string): Promise<boolean> {
        await this.files();
        if (!this.#filesAll![name]) return false;
        const dbFile = this.#filesAll![name];
        await this.db.table("page_file").delete({ page_id: String(this), name });
        const used = await dbFile.used();
        if (!used) await dbFile.remove();
        this.#files = null; this.#filesAll = null;
        return true;
    }

    async hasFile(name: string): Promise<DbFile | undefined> {
        return (await this.files())[name];
    }

    async sortFiles(sort: string[]): Promise<void> {  // todo, security: just existing files allowed!
        let i = 1;
        for (const file of sort) {
            await this.db.table("page_file").update({ page_id: String(this), name: file, sort: i++ });
        }
        this.#files = null; this.#filesAll = null;
    }

    /* URLs */
    async urls(): Promise<Record<string, any>> {
        if (this.#urls === null) {
            this.#urls = {};
            const rows = await this.db.all(`SELECT lang, url, target FROM ${tableRef("page_url")} WHERE page_id = ?`, [this.id]);
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
        const row = await this.db.row(`SELECT * FROM ${tableRef("page_url")} WHERE page_id = ? AND lang = ?`, [this.id, lang]);
        await this.db.table("page_url")[row ? "update" : "insert"](data);
        this.#urls = null; // neu
    }

    async urlSeoGenerated(lang: string): Promise<string> {
        if (this.vs.type === "c") return "#cmspid" + this;
        const parent = await this.parent();
        const parentUrl = !parent || String(parent) === "1" ? lang : await parent.urlSeo(lang);
        const titleT = await this.title();
        const titleStr = titleT ? await titleT.orFallback(lang).then((t: any) => t.get()) ?? "" : "";
        const part = urlize(titleStr);
        const base = parentUrl === "" || parentUrl.endsWith("/") ? parentUrl : parentUrl + "/";
        let url = base + part;
        const exists = await this.db.one(`SELECT page_id FROM ${tableRef("page_url")} WHERE url = ? AND NOT (page_id = ? AND lang = ?)`, [url, this.id, lang]);
        if ((await Deno.stat(this.app.appPATH + url).catch(() => null)) || exists) {
            url += "-" + lang + this;
        }
        return url;
    }

    async urlSeoGen(lang: string): Promise<string> {
        const row = await this.db.row(`SELECT * FROM ${tableRef("page_url")} WHERE page_id = ? AND lang = ?`, [this.id, lang]);
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
        const P = await this.cms.node(Number(id ?? "0"));
        if (!id) return P;

        const accessUsrs = await this.db.all("SELECT * FROM page_access_usr WHERE page_id = ?", [this.id]);
        for (const data of accessUsrs) await this.db.table("page_access_usr").insert({ ...data, page_id: String(P) });
        const accessGrps = await this.db.all("SELECT * FROM page_access_grp WHERE page_id = ?", [this.id]);
        for (const data of accessGrps) await this.db.table("page_access_grp").insert({ ...data, page_id: String(P) });

        await P.texts();
        await P.files();

        // Apply this node's "subpage definition" (childXML) to the new page child; tolerate malformed user input
        if (vs.type === "p" && "childXML" in this.settings) {
            try {
                await P.fromXml(String(this.settings.childXML() ?? ""));
            } catch (e) {
                console.warn(`childXML of node ${this.id} could not be applied:`, e);
            }
        }

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

    /** childXML attributes that map directly to a node column */
    static #xmlAttrs = new Set(["module", "online_end", "online_start", "visible", "public", "name"]);
    /** Build descendant nodes from a "subpage definition" (childXML template). */
    async fromXml(xml: string): Promise<void> {
        const root = parseXml(xml);
        if (root) await this.#fromXmlNode(root);
    }
    async #fromXmlNode(node: XmlNode): Promise<void> {
        const langs = this.app.languages.all;
        for (const [name, value] of Object.entries(node.attrs)) {
            if (langs.includes(name)) { await this.title(name, value); continue; }
            if (!Node.#xmlAttrs.has(name)) continue;
            await this.set(name, value); // IMPORTANT: module access rights still need to be clarified — currently every module is allowed
        }
        for (const child of [...node.children].reverse()) {
            const C = child.tag === "cont" ? await this.createCont() : child.tag === "page" ? await this.createChild() : null;
            if (C) await C.#fromXmlNode(child);
        }
    }

    async copy(deep = false, ifFn?: (p: Node) => Promise<boolean | void> | boolean | void): Promise<Node | false> {
        if (await ifFn?.(this) === false) return false;

        const row: Record<string, any> = { ...this.vs };
        delete row["id"];
        const newId = Number(await this.db.table("page").insert(row) ?? "0");
        if (!newId) return false;
        const P = await this.cms.node(newId);

        const titleCopy = await (await this.title())!.copy();
        const ctx = getCtx();
        await P.set({ log_id: await ctx.logId, title_id: titleCopy.id });
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
            for (const Text of Object.values(newTexts)) {
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
        const P = await this.cms.node(Number(PageArg));
        const OldParent = await P.parent();
        const BeforePage = Before ? await this.cms.node(Number(Before)) : null;
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
        const P = await this.cms.node(Number(Child));
        const children = await this.children({ type: "*" });
        if (!children.has(Number(P))) return false;
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
