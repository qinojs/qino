import { $item, bildJsonItem, enableItemSchemaDefaults, hee, html, getCtx, urlize, unixTime, isFile, sql, tableRef, DbFile, isEmptyObject } from "@qino/qino";

import { cmsCtx } from "./CmsContext.ts";
import { resolveText } from "./resolveText.ts";
import { policyOf, sanitizeHtml } from "./sanitize.ts";
import { parseXml } from "./parseXml.ts";
import { postedVars } from "./postedVars.ts";

import type { HtmlString, AppEvents, DbText, DbTextLang, Usr, DbRow, Module } from "@qino/qino";
import type { CMS } from "./CMS.ts";
import type { XmlNode } from "./parseXml.ts";

/** Node class
 * represents both "Page" (type "p") and "Cont"/"Content" (type "c") entries in the database
 */
export class Node {

    cms: CMS;
    app: CMS["app"];
    db: CMS["app"]["db"];

    id: number = 0;
    vs: Record<string, string | number | null> = {};

    #is = true;

    #title: DbText | null = null;
    #texts: Map<string, DbText> | null = null;
    #files: Promise<Map<string, DbFile>> | null = null;
    #filesAll: Map<string, DbFile> | null = null;
    #urls: Map<string, Record<string, string>> | null = null;

    #children: Promise<Map<number, Node>> | null = null;
    #named = new Map<string, Map<string, Node>>();
    #conts: Node[] | null = null;

    constructor(cms: CMS, id = 0, vs?: Record<string, string | number>) {
        this.cms = cms;
        this.app = cms.app;
        this.db = cms.app.db;
        this.id = Number(id);
        if (vs) this.vs = vs;
    }

    async init(): Promise<this> {
        if (!this.vs || isEmptyObject(this.vs)) {
            this.vs = await this.db.row`SELECT * FROM ${sql.id(tableRef("page"))} WHERE id = ${this.id}` ?? {};
        }
        await this.app.fire("node:construct", { node: this });
        if (isEmptyObject(this.vs)) {
            this.vs = { id: this.id, basis: 0, type: "p" };
            this.#is = false;
            return this;
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
        enableItemSchemaDefaults(this.settings[$item]);

        if (!this.vs.title_id) {
            const text = await this.app.dbTexts.generate();
            await this.set("title_id", text.id);
        }
        return this;
    }

    exists(): this | undefined { return this.#is ? this : undefined; }

    /* Cache invalidation */
    #clearTreeCache(): void { this.#children = this.#conts = null; this.#named.clear(); }
    #clearFileCache(): void { this.#files = this.#filesAll = null; }
    #clearUrlCache(): void { this.#urls = null; }

    async set(data: string | Record<string, any>, value?: any): Promise<void> {
        if (!this.#is) {
            console.warn(`Node ${this.id} does not exist! (::set)`);
            return;
        }
        if (typeof data === "string") data = { [data]: value };

        if (!Object.entries(data).some(([n, v]) => this.vs[n] !== v)) return;

        this.vs = { ...this.vs, ...data };
        await this.db.table("page").update(this.id, data);
    }

    // Access control
    async access(user?: Usr | null): Promise<number> {
        const ctx = getCtx();
        user ??= ctx.user;
        const usrId = Number(user);
        const cache = cmsCtx(ctx).accessCache;
        const key = `${this.id}:${usrId}`;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        const e: AppEvents["node:access"] = { node: this, user, access: await this.#rawAccess(user) };
        const access = (await this.app.fire("node:access", e)).access;
        cache.set(key, access);
        return access;
    }

    /** Node-level access before node:access adjustments (module axis). Inheritance builds on
     *  this — a parent's module rules only apply to the parent, never to its children. */
    async #rawAccess(user?: Usr | null): Promise<number> {
        const cache = cmsCtx(getCtx()).accessCache;
        const key = `${this.id}:${Number(user)}:raw`;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        const access = await this.#calcUsrAccess(user);
        cache.set(key, access);
        return access;
    }

    async #calcUsrAccess(user?: Usr | null): Promise<number> {

        if (user?.superuser) return 3;

        const nodeLevel = this.vs.access === null ? null : Number(this.vs.access ?? "0");

        // inherited (or explicit user) access level
        const parent = await this.parent();
        if (nodeLevel === null && parent)
            return Math.max(await parent.#rawAccess(user), await this.#accessUserLevel(user));

        // user
        if (!user) return Number(nodeLevel); // no user, return node level (or 0 if null)
        const access = Math.max(Number(nodeLevel), await this.#accessUserLevel(user));
        if (access === 3) return 3; // already ADMIN, no need to check groups

        // group
        const grpAccess = await this.#accessGroupLevel(await user.grps());
        
        // return the higher of the two
        return Math.max(access, grpAccess);
    }
    async #accessGroupLevel(grps?: number[] | null): Promise<number> {
        if (!grps || !grps.length) return 0;
        return Number(await this.db.one`
            SELECT max(access) AS access FROM page_access_grp
            WHERE page_id = ${this.id}
                AND ${sql.in("grp_id", grps)}`) || 0;
    }
    async #accessUserLevel(user?: Usr | null): Promise<number> {
        if (!user?.$exists) return 0;
        return Number(await this.db.one`SELECT access FROM page_access_usr WHERE page_id = ${this.id} AND usr_id = ${String(user)}` ?? "0") || 0;
    }

    /* Render */
    async html(vars: Record<string, any> = {}): Promise<HtmlString> {
        if (!(await this.isReadable())) return html.raw("");
        const ctx = getCtx();

        const posted = postedVars(this.id);
        if (posted) vars = { ...vars, ...posted };

        const renderPath = cmsCtx(ctx).renderPath;
        if (renderPath.has(this.id)) {
            return html.raw(this.edit ? `<div qcms-id=${this.id}>Recursion, Content ${this.id} again!</div>` : "");
        }
        const mod = this.module;
        const nodeExports = mod?.plugin.cms?.node;
        const isAbsolute = (f: string) => f.startsWith("http://") || f.startsWith("https://") || f.startsWith("/");
        for (const file of nodeExports?.css ?? []) ctx.res.html.styles.add(isAbsolute(file) ? file : mod!.modUrl + file);
        for (const file of nodeExports?.js ?? [])  ctx.res.html.scripts.add(isAbsolute(file) ? file : mod!.modUrl + file);
        // App-specific css of this module
        if (mod && await isFile(mod.data + "pub/main.css", ctx.dev)) ctx.res.html.styles.add(mod.dataUrl + "pub/main.css");

        renderPath.add(this.id);
        try { return await this.htmlPrepared(vars); }
        finally { renderPath.delete(this.id); }
    }

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
        const rendered = str.replace(/^<([^\s>]+)([\s]?)/, `<$1${attr}$2`);
        return html.raw(rendered !== str ? rendered : `<div${attr}>${str}</div>`);
    }

    async htmlRaw(vars: Record<string, any> = {}): Promise<string | undefined> {
        if (!this.#is) { console.warn("Page does not exist!"); return; }
        return this.#renderGuarded(async () => {
            if (!this.module) throw new Error(`Module "${this.vs.module}" is not imported`);
            let render = this.module.plugin.cms?.node?.render;
            if (!render) {
                const e: AppEvents["node:render"] = { node: this, render: null };
                render = (await this.app.fire("node:render", e)).render ?? undefined;
            }
            if (!render) throw new Error(`No render function for module "${this.vs.module}"`);
            return render(this, {ctx:getCtx(), vars});
        });
    }

    async htmlPart(part: string, vars: Record<string, any> = {}): Promise<HtmlString | undefined> {
        if (!(await this.isReadable()) || /[/\\]/.test(part)) return;
        const parts = this.module?.plugin.cms?.node?.parts ?? {};
        const fn = Object.hasOwn(parts, part) && typeof parts[part] === "function" ? parts[part] : undefined;
        if (!fn) return;
        return html.raw(await this.#renderGuarded(() => fn(this, {ctx:getCtx(), vars})));
    }

    /** Run a module render callback, returning error markup instead of throwing. */
    async #renderGuarded(run: () => unknown): Promise<string> {
        try {
            return String(await run());
        } catch (err: any) {
            console.error(`Error in module "${this.vs.module}": ${err.message}`, err);
            return this.edit ? `<div>Webmaster: ${await this.app.t`module error!`} <code>${hee(err.message)}</code></div>` : '<div></div>';
        }
    }

    get module(): Module | undefined {
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
        // small grace window so a freshly set online_start/end takes effect despite clock skew
        const now = unixTime() + 99;
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
        const cache = cmsCtx(ctx).accessCache;
        const cachedAccess = cache.get(`${this.id}:${usrId}`) ?? 0;
        return cachedAccess > 1 && !!cmsCtx(ctx).editmode;
    }

    async page(): Promise<Node> {
        const parent = await this.parent();
        return this.vs.type === "p" || !parent ? this : await parent.page();
    }

    settings: any = {};

    get modUrl(): string { return this.module?.modUrl ?? getCtx().req.moduleUrl + this.vs.module + "/"; }

    /* Tree traversal */
    children(filter?: any): Promise<Map<number, Node>> {
        this.#children ??= (async () => {
            const map = new Map<number, Node>();
            const rows = await this.db.query`SELECT * FROM ${sql.id(tableRef("page"))} WHERE basis = ${this.id} ORDER BY type DESC, sort, id DESC`;
            const e = await this.app.fire("node:children", { node: this, rows });
            for (const row of e.rows) {
                const id = Number(row.id);
                if (map.has(id)) continue;
                const child = await this.cms.node(id, row);
                if (!child.exists() || Number(child.vs.basis) !== this.id) continue;
                map.set(id, child);
                if (child.vs.name) {
                    this.#named.getOrInsertComputed(String(child.vs.type), () => new Map())
                        .set(String(child.vs.name), child);
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
        for (const page of path.values()) if (i++ === level) return page;
    }

    async path(): Promise<Map<number, Node>> {
        const parent = await this.parent();
        const path = parent ? new Map(await parent.path()) : new Map();
        path.set(this.id, this);
        return path;
    }

    async bough(filter?: any): Promise<Map<number, Node>> {
        const bough = new Map<number, Node>([[this.id, this]]);
        for (const child of (await this.children({ type: "*" })).values())
            for (const [k, v] of (await child.bough()).entries()) bough.set(k, v);
        return filter ? this.cms.filter(bough, filter) : bough;
    }

    async in(ref: Node | number): Promise<boolean> {
        return (await this.path()).has(Number(ref));
    }

    /* Texts */

    async #showTextLang(dbText: DbText, lang?: string | null): Promise<any> {
        const ctx = getCtx();
        const textLang = lang == null ? await dbText.orFallback(ctx.lang) : dbText.lang(lang);
        let text = await textLang.get();
        if (text !== "") { // an empty text has nothing to resolve and nothing to sanitize
            text = await resolveText(this.app, text, !this.edit);
            text = sanitizeHtml(text, policyOf(this.app)); // last step: nothing may touch the string after sanitizing
        }
        return {
            lang: textLang.lang,
            id: textLang.text.id,
            toString() { return text; },
            html: () => html.raw(text),
        };
    }

    async showText(name = "main", lang?: string | null): Promise<any> {
        return this.#showTextLang(await this.text(name), lang);
    }

    async showTitle(lang?: string | null): Promise<any> {
        return this.#showTextLang(await this.title(), lang);
    }

    async texts(): Promise<Map<string, DbText>> {
        if (this.#texts === null) {
            const rows = await this.db.indexCol`SELECT name, text_id FROM ${sql.id(tableRef("page_text"))} WHERE page_id = ${this.id}`;
            this.#texts = new Map();
            for (const [name, id] of rows) this.#texts.set(name, this.app.dbTexts.text(Number(id)));
        }
        return this.#texts;
    }

    async text(name?: string): Promise<DbText>;
    async text(name: string, lang: string | null): Promise<DbTextLang>;
    async text(name: string, lang: string | null, value: any): Promise<DbTextLang | undefined>;
    async text(name = "main", lang?: string | null, value?: any): Promise<DbText | DbTextLang | undefined> {
        const texts = await this.texts();
        let text = texts.get(name);
        if (!text) {
            text = await this.db.transaction(async () => {
                const created = await this.app.dbTexts.generate();
                await this.db.table("page_text").insert({ name, page_id: String(this), text_id: created.id });
                return created;
            });
            texts.set(name, text);
        }
        if (lang == null) return text;
        const textLang = await text.lang(lang);
        if (value === undefined) return textLang;
        if (await textLang.get() === value) return;
        await textLang.set(value);
        return textLang;
    }

    async textDelete(name: string): Promise<void> {
        const texts = await this.texts();
        const text = texts.get(name);
        if (!text) return;
        await this.db.table("text").deleteWhere({ id: text.id }); // composite key (id, lang): every language row goes
        texts.delete(name);
    }

    async title(lang?: string | null, value?: any): Promise<any> {
        this.#title ??= this.app.dbTexts.text(Number(this.vs.title_id ?? "0"));
        if (lang == null) return this.#title;
        const textLang = await this.#title.lang(lang);
        if (value === undefined) return textLang.get();
        if (await textLang.get() === value) return;
        await textLang.set(value);
        await this.urlsSeoGen();
        return textLang;
    }

    /* Files */
    files(): Promise<Map<string, DbFile>> {
        if (!this.#files) {
            this.#filesAll = new Map();
            this.#files = (async () => {
                const files = new Map<string, DbFile>();
                const rows = await this.db.query`
                    SELECT f.*, pf.name as pf_name
                    FROM ${sql.id(tableRef("page_file"))} pf
                      LEFT JOIN ${sql.id(tableRef("file"))} f ON f.id = pf.file_id
                    WHERE pf.page_id = ${this.id}
                    ORDER BY sort`;
                const dbFiles = await Promise.all(rows.map((vs) => this.app.dbFiles.file(vs.id, vs)));
                const exist = await Promise.all(dbFiles.map((f) => f.exists()));
                rows.forEach((vs, i) => {
                    this.#filesAll!.set(vs.pf_name, dbFiles[i]);
                    if (exist[i]) files.set(vs.pf_name, dbFiles[i]);
                });
                return files;
            })();
        }
        return this.#files;
    }

    async filesAndPlaceholders(): Promise<Map<string, DbFile>> {
        await this.files();
        return this.#filesAll!;
    }

    async file(name: string): Promise<DbFile> {
        await this.files();
        return this.#filesAll!.get(name) ?? await this.addFile(undefined, name);
    }

    async addFile(file?: DbFile | string, name?: string): Promise<DbFile> {

        const dbFile = file instanceof DbFile ? file : await this.app.dbFiles.add(file);

        const row: Record<string, string | number> = { page_id: String(this), file_id: String(dbFile) };
        if (!name) {
            const minSort = await this.db.one`SELECT min(sort) FROM ${sql.id(tableRef("page_file"))} WHERE page_id = ${this.id}`;
            row.sort = (Number(minSort) || 0) - 1;
            name = "_" + Math.random().toString(36).slice(2, 9);
        }
        row.name = name;
        await this.db.table("page_file").ensure(row);
        this.#clearFileCache();
        return dbFile;
    }

    deleteFile(name: string): Promise<boolean> {
        return this.db.transaction(() => this.#deleteFile(name));
    }
    async #deleteFile(name: string): Promise<boolean> {
        await this.files();
        const dbFile = this.#filesAll!.get(name);
        if (!dbFile) return false;
        await this.db.table("page_file").delete({ page_id: String(this), name });
        const used = await dbFile.used();
        if (!used) await dbFile.remove();
        this.#clearFileCache();
        return true;
    }

    async hasFile(name: string): Promise<DbFile | undefined> {
        return (await this.files()).get(name);
    }

    /** Reorder files by name. Unknown names are ignored; existing files left out
     *  of the list keep their relative order and are appended at the end. */
    async sortFiles(sort: string[]): Promise<void> {
        const names = [...(await this.filesAndPlaceholders()).keys()];
        const wanted = [...new Set(sort)].filter((n) => names.includes(n));
        const ordered = [...wanted, ...names.filter((n) => !wanted.includes(n))];
        const table = this.db.table("page_file");
        await this.db.transaction(() =>
            Promise.all(ordered.map((name, i) => table.update({ page_id: String(this), name, sort: i + 1 }))),
        );
        this.#clearFileCache();
    }

    /* URLs */
    async urls(): Promise<Map<string, Record<string, string>>> {
        if (this.#urls === null) {
            this.#urls = new Map();
            const rows = await this.db.query`SELECT lang, url, target FROM ${sql.id(tableRef("page_url"))} WHERE page_id = ${this.id}`;
            for (const row of rows) this.#urls.set(row.lang, row);
        }
        return this.#urls;
    }

    async url(lang?: string): Promise<string> {
        const ctx = getCtx();
        lang ??= ctx.lang;
        const hash = this.vs.type === "c" ? await this.urlSeo(lang) : "";
        await this.access(); // hack: `edit` reads the access cache synchronously — fill it, whatever the caller did before
        if (this.edit) return ctx.req.appUrl + "?cmspid=" + await this.page() + "&lang=" + lang + hash;
        return ctx.req.appUrl + (await (await this.page()).urlSeo(lang)) + hash;
    }

    async urlSeo(lang: string): Promise<string> {
        const urls = await this.urls();
        let url = urls.get(lang);
        if (!url) urls.set(lang, url = { url: await this.#urlSeoOwn(lang), target: "" });
        return url.url;
    }

    async urlSet(lang: string, data: Record<string, any>): Promise<void> {
        data = { page_id: this.id, lang, ...data };
        const row = await this.db.row`SELECT * FROM ${sql.id(tableRef("page_url"))} WHERE page_id = ${this.id} AND lang = ${lang}`;
        // No-op guard: SEO regeneration walks the whole subtree × all languages and
        // usually re-writes the identical url. Skip unchanged writes so they neither
        // hit the db nor show up as bogus "URL changed" history entries.
        if (row && Object.keys(data).every((k) => row[k] === data[k])) return;
        await this.db.table("page_url")[row ? "update" : "insert"](data);
        this.#clearUrlCache();
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
        const exists = await this.db.one`SELECT page_id FROM ${sql.id(tableRef("page_url"))} WHERE url = ${url} AND NOT (page_id = ${this.id} AND lang = ${lang})`;
        if (await Deno.stat(this.app.dir + url).catch(() => null) || exists) url += "-" + lang + this;
        return url;
    }

    /** Generate + persist this node's own SEO url. No subtree walk, so it's safe to call from a read. */
    #urlSeoOwn(lang: string): Promise<string> {
        return this.db.transaction(async () => {
            const row = await this.db.row`SELECT * FROM ${sql.id(tableRef("page_url"))} WHERE page_id = ${this.id} AND lang = ${lang}`;
            const url = row?.custom ? row.url : await this.urlSeoGenerated(lang);
            await this.urlSet(lang, { url });
            return url;
        });
    }

    /** Regenerate this node's url and the whole subtree (after move/rename). */
    urlSeoGen(lang: string): Promise<string> {
        return this.db.transaction(async () => {
            const url = await this.#urlSeoOwn(lang);
            for (const child of (await this.children({ type: "*" })).values()) await child.urlSeoGen(lang);
            return url;
        });
    }

    urlsSeoGen(): Promise<void> {
        return this.db.transaction(async () => {
            for (const l of this.cms.app.languages.all) await this.urlSeoGen(l);
        });
    }

    /* Tree manipulation */
    createChild(vs: Record<string, any> = {}): Promise<Node> {
        return this.db.transaction(() => this.#createChild(vs));
    }
    async #createChild(vs: Record<string, any>): Promise<Node> {
        vs = {
            basis: this.id,
            online_start: unixTime(),
            access: this.vs.access,
            module: this.vs.module,
            type: "p",
            searchable: this.vs.searchable,
            visible: true,
            ...vs,
        };
        const id = await this.db.table("page").insert(vs);
        const page = await this.cms.node(Number(id ?? "0"));
        if (!id) return page;

        const accessUsrs = await this.db.query`SELECT * FROM page_access_usr WHERE page_id = ${this.id}`;
        for (const data of accessUsrs) await this.db.table("page_access_usr").insert({ ...data, page_id: String(page) });
        const accessGrps = await this.db.query`SELECT * FROM page_access_grp WHERE page_id = ${this.id}`;
        for (const data of accessGrps) await this.db.table("page_access_grp").insert({ ...data, page_id: String(page) });

        await page.texts();
        await page.files();

        // Apply this node's "subpage definition" (childXML) to the new page child; tolerate malformed user input
        if (vs.type === "p" && "childXML" in this.settings) {
            await page.fromXml(String(this.settings.childXML() ?? ""))
                .catch(e => console.warn(`childXML of node ${this.id} could not be applied:`, e));
        }

        // Re-sort children so the new child gets a proper sort position
        this.#clearTreeCache();
        let i = 0;
        for (const child of (await this.children({ type: vs.type })).values()) await child.set("sort", ++i);

        return page;
    }

    createCont(vs: Record<string, string | number | boolean | null> = {}): Promise<Node> {
        vs = { type: "c", module: "cms.cont.flexible", visible: "", online_start: null, access: null, ...vs };
        return this.createChild(vs);
    }

    /** childXML attributes accepted as node fields */
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
            await this.set(name === "public" ? "access" : name, name === "public" ? Number(value) : value);
        }
        for (const child of [...node.children].reverse()) {
            const created = child.tag === "cont" ? await this.createCont() : child.tag === "page" ? await this.createChild() : null;
            if (created) await created.#fromXmlNode(child);
        }
    }

    copy(deep = false, ifFn?: (p: Node) => Promise<boolean | void> | boolean | void): Promise<Node | undefined> {
        return this.db.transaction(() => this.#copy(deep, ifFn));
    }
    async #copy(deep: boolean, ifFn?: (p: Node) => Promise<boolean | void> | boolean | void): Promise<Node | undefined> {
        if (await ifFn?.(this) === false) return;

        const row: Record<string, any> = { ...this.vs };
        delete row.id;
        const newId = Number(await this.db.table("page").insert(row) ?? "0");
        if (!newId) return;
        const page = await this.cms.node(newId);

        const titleCopy = await (await this.title())!.copy();
        const ctx = getCtx();
        await page.set({ log_id: await ctx.logId, title_id: titleCopy.id });
        page.#title = titleCopy;

        const texts = await this.texts();
        for (const [name, text] of texts) {
            const textCopy = await text.copy();
            await this.db.table("page_text").insert({ page_id: newId, text_id: textCopy.id, name });
        }
        page.#texts = null;

        const old2new: Record<string, string> = {};
        const files = await this.files();
        for (const [name, file] of files) {
            const newFile = await file.clone();
            old2new[String(file.id)] = String(newFile.id);
            await this.db.table("page_file").insert({ page_id: newId, file_id: newFile.id, name });
        }
        page.#clearFileCache();

        if (!isEmptyObject(old2new)) {
            const newTexts = await page.texts();
            for (const dbText of newTexts.values()) {
                for (const l of this.app.languages.all) {
                    const tl = dbText.lang(l);
                    const old = await tl.get();
                    let text = old;
                    for (const [oldId, newFileId] of Object.entries(old2new)) {
                        text = text.replaceAll(`/dbFile/${oldId}/`, `/dbFile/${newFileId}/`);
                    }
                    if (text !== old) await tl.set(text);
                }
            }
        }

        for (const cont of (await this.children({ type: deep ? "*" : "c" })).values()) {
            const copy = await cont.copy(deep, ifFn);
            if (copy) await copy.set("basis", newId);
        }

        page.#clearTreeCache();

        const parent = await this.parent();
        if (parent) parent.#clearTreeCache();
        
        return page;
    }

    insertBefore(pageArg: Node | number, before?: Node | number | null): Promise<boolean> {
        return this.db.transaction(() => this.#insertBefore(pageArg, before));
    }
    async #insertBefore(pageArg: Node | number, before?: Node | number | null): Promise<boolean> {
        const page = await this.cms.node(Number(pageArg));
        const oldParent = await page.parent();
        const beforePage = before ? await this.cms.node(Number(before)) : null;
        if (await this.in(page)) return false;
        const type = page.vs.type;

        let sort: number | null = null;
        let i = 1;
        for (const child of (await this.children({ type })).values()) {
            if (String(page) === String(child)) continue;
            if (beforePage && String(beforePage) === String(child)) sort = i++;
            await child.set("sort", i++);
        }
        sort = sort !== null ? sort : i++;
        await page.set({ basis: this.id, sort });

        this.#clearTreeCache();

        if (oldParent) oldParent.#clearTreeCache();

        await page.urlsSeoGen();
        return true;
    }

    removeChild(child: Node | number): Promise<boolean> {
        return this.db.transaction(() => this.#removeChild(child));
    }
    async #removeChild(child: Node | number): Promise<boolean> {
        const page = await this.cms.node(Number(child));
        const children = await this.children({ type: "*" });
        if (!children.has(Number(page))) return false;
        for (const sub of (await page.children({ type: "*" })).values()) await page.removeChild(sub);
        for (const name of [...(await page.files()).keys()]) await page.deleteFile(name);
        for (const name of [...(await page.texts()).keys()]) await page.textDelete(name);
        await this.db.table("page").delete(String(page));
        this.#clearTreeCache();
        return true;
    }

    async cont(name: string, attris: any = {}): Promise<Node> {
        const conts = await this.conts();
        const named = this.#named.getOrInsertComputed("c", () => new Map());
        let cont = named.get(name);
        if (!cont) {
            if (typeof attris !== "object") attris = { module: attris };
            attris.name = name;
            attris.sort = conts.length + 1;
            named.set(name, cont = await this.createCont(attris));
        }
        return cont;
    }

    /* Access */
    async changeUser(user: Usr | number, access: number): Promise<this> {
        const vs = { page_id: String(this), usr_id: String(user), access };
        if (!access) await this.db.table("page_access_usr").delete(vs);
        else await this.db.table("page_access_usr").ensure(vs);
        return this;
    }
    async changeGroup(grp: DbRow | number, access: number): Promise<this> {
        const vs = { page_id: String(this), grp_id: String(grp), access };
        if (!access) await this.db.table("page_access_grp").delete(vs);
        else await this.db.table("page_access_grp").ensure(vs);
        return this;
    }

    toString(): string { return String(this.id); }

}
