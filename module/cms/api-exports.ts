// deno-lint-ignore-file no-explicit-any
import { AccessError, ApiError, FileTransformer, getCtx, hee, html, sql, sqlSearch, unixTime } from "@qino/qino";

import { cms } from "./lib/CMS.ts";
import { ADMIN } from "./lib/access.ts";

import type { Node } from "./lib/Node.ts";

// ─── business logic used by REST ──────────────

export async function nodeToJson(node: Node, type = "*"): Promise<any> {
    const access = await node.access(); // first: showTitle() and url() reuse the cached level
    const [title, children, url, online, isPublic] = await Promise.all([
        node.showTitle(), node.children({ type }), node.url(), node.isOnline(), node.isPublic(),
    ]);
    return {
        id:          node.id,
        title:       access ? (String(title).trim() || "-") : "(no access)",
        title_id:    title.id,
        numChildren: children.size,
        url,
        myaccess:    access,
        visible:     Number(node.vs?.visible ?? 0),
        online:      online ? 1 : 0,
        public:      isPublic ? 1 : 0,
        type:        node.vs.type,
        module:      node.vs.module,
        name:        String(node.vs.name ?? ""),
        // what PATCH accepts, it also returns: null = inherited, 0 = always
        searchable:  Number(node.vs?.searchable ?? 0),
        onlineStart: node.vs.online_start === null ? null : Number(node.vs.online_start),
        onlineEnd:   node.vs.online_end === null ? null : Number(node.vs.online_end),
        basis:       String(node.vs.basis ?? ""),
    };
}

// Recursive tree serializer over node.children(); self = include the node itself, not only its children.
export async function treeToJson(opts: {
    node: Node;
    self?: boolean;
    type: string;
    entry: (n: Node) => Promise<Record<string, unknown>>;
    expand?: (n: Node, level: number) => boolean | Promise<boolean>;
    access?: number; // min access to include a node incl. subtree (default 1)
    emptyChildren?: boolean;
}, level = 1): Promise<any[]> {
    const nodes = opts.self ? [opts.node] : (await opts.node.children({ type: opts.type })).values();
    const res = [];
    for (const n of nodes) {
        if (await n.access() < (opts.access ?? 1)) continue;
        const entry = await opts.entry(n);
        if (!opts.expand || await opts.expand(n, level)) {
            const children = await treeToJson({ ...opts, node: n, self: false }, level + 1);
            if (children.length || opts.emptyChildren) entry.children = children;
        }
        res.push(entry);
    }
    return res;
}

export async function tree(start: any, opt: any = {}): Promise<any[]> {
    const ctx = getCtx();
    const filter = opt.filter ?? "*";
    const inNode = opt.in ? await cms(ctx.app).node(opt.in) : null;
    const self = String(start) === "0";
    return treeToJson({
        node: await cms(ctx.app).node(self ? 1 : start),
        self,
        type: filter,
        access: 0, // no-access nodes stay listed, nodeToJson masks their title
        entry: (n: Node) => nodeToJson(n, filter),
        expand: async (n: Node, level: number) => (!inNode || await inNode.in(n)) && (!opt.level || opt.level > level),
        emptyChildren: true,
    });
}

// Assignable modules, same source and check as the backend's add widget. cms.cont.flexible is
// included (the widget only hides it because it is the drop target).
const MODULE_SVG = "pub/module.svg";

/** Modules the user may insert; `only` picks one, with its settings schema. */
export async function modules(only?: string): Promise<any[]> {
    const ctx = getCtx();
    const c = cms(ctx.app);
    const res = [];
    for (const [kind, mods] of Object.entries({ cont: c.getModules(), layout: c.getLayouts() })) {
        for (const [name, mod] of Object.entries(mods)) {
            if (only && only !== name) continue;
            const e = await c.fire("module:access", { module: name, user: ctx.user ?? undefined, access: ADMIN });
            if (Number(e.access) < ADMIN) continue;
            res.push({
                name,
                kind,
                description: mod.description.trim(),
                // the module's icon, so clients don't need the manifest
                ...(mod.manifest?.files?.includes(MODULE_SVG) && { icon: mod.modUrl + MODULE_SVG }),
                ...(only && { settings: mod.plugin.cms?.node?.settingsSchema ?? {} }),
            });
        }
    }
    return res;
}

export function nodeRemove(node: any): Promise<{ parent_id: number }> {
    return getCtx().app.db.transaction(() => nodeRemoveTx(node));
}
async function nodeRemoveTx(node: any): Promise<{ parent_id: number }> {
    const ctx  = getCtx();
    const ret  = { parent_id: Number(await node.parent()) };
    const trash = await cms(ctx.app).nodeByPath(["system", "trash"]);
    if (!trash) throw new ApiError(500, "No trash page (system/trash)");
    if (await node.in(trash)) {
        if (await node.access() < 3) throw new AccessError("Forbidden");
        await (await node.parent()).removeChild(node);
    } else {
        const parent = await node.parent();
        const siblings = parent ? [...(await parent.children({ type: node.vs.type })).values()] : [];
        const idx = siblings.findIndex(s => s.id === node.id);
        const before = siblings[idx + 1] ?? null;
        await trash.insertBefore(node, await trash.cont("main"));
        await node.settings.__deleted({
            from:   String(parent ?? ""),
            before: String(before ?? ""),
            time:   String(unixTime()),
            by:     String(ctx.user?.username ?? ""),
        });
        const bough = await node.bough();
        for (const child of bough.values()) {
            if (child.vs?.access !== null) await child.set("access", 0);
            await ctx.app.db.exec`DELETE FROM page_access_usr WHERE page_id = ${child.id} AND access < 2`;
            await ctx.app.db.exec`DELETE FROM page_access_grp WHERE page_id = ${child.id} AND access < 2`;
        }
    }
    return ret;
}

export function nodeRestore(node: any): Promise<{ url: string }> {
    return getCtx().app.db.transaction(() => nodeRestoreTx(node));
}
async function nodeRestoreTx(node: any): Promise<{ url: string }> {
    const ctx   = getCtx();
    const trash = await cms(ctx.app).nodeByPath(["system", "trash"]);
    if (!trash || !await node.in(trash)) throw new ApiError(400, "Node is not in trash");
    if (await node.access() < 2) throw new AccessError("Forbidden");
    const fromId   = Number(await node.settings.__deleted.from);
    const beforeId = Number(await node.settings.__deleted.before);
    const toNode   = fromId ? await cms(ctx.app).node(fromId) : null;
    if (!toNode || await toNode.access() < 2) throw new AccessError("Original parent no longer accessible");
    const before = beforeId ? await cms(ctx.app).node(beforeId) : null;
    await toNode.insertBefore(node, before);
    await node.settings.__deleted(undefined);
    return { url: await node.url() };
}

/** A preview at the requested size, if the tools for that file type are installed. */
const THUMB: Record<string, { fmt?: string; page?: number; frame?: number; tool: "magick" | "ffmpeg" }> = {
    jpg: { page: 1, tool: "magick" }, jpeg: { page: 1, tool: "magick" }, gif: { page: 1, tool: "magick" },
    png: { page: 1, tool: "magick" }, svg: { page: 1, tool: "magick" }, webp: { page: 1, tool: "magick" },
    pdf: { page: 1, tool: "magick" },
    mp4: { fmt: "jpg", frame: 1, tool: "ffmpeg" }, webm: { fmt: "jpg", frame: 1, tool: "ffmpeg" },
    mov: { fmt: "jpg", frame: 1, tool: "ffmpeg" }, avi: { fmt: "jpg", frame: 1, tool: "ffmpeg" },
    mkv: { fmt: "jpg", frame: 1, tool: "ffmpeg" },
    mp3: { tool: "ffmpeg" }, flac: { tool: "ffmpeg" }, ogg: { tool: "ffmpeg" },
    aac: { tool: "ffmpeg" }, wav: { tool: "ffmpeg" }, m4a: { tool: "ffmpeg" },
};

/** The shared preview boxes; a preview fits inside, so lists can reserve it with width/height.
 *  Loaded at twice the size for sharp high-DPI screens. Mirrored in `.cms-thumb` (cms/pub/css/ui.css). */
export const THUMB_SIZES = { small: { width: 70, height: 40 }, big: { width: 210, height: 120 } };
export type ThumbSize = keyof typeof THUMB_SIZES;
type ThumbOptions = { size?: ThumbSize; grant?: "session" | "permanent" };

/** The shared preview of a file, if the tools for its type are installed: few sizes, so browsers
 *  cache each once. A `grant` signs it for files that are not public. */
export async function thumbUrl(file: any, { size = "small", grant }: ThumbOptions = {}): Promise<string | undefined> {
    const spec = THUMB[String(file.extension)], box = THUMB_SIZES[size];
    if (!spec || !box || !await FileTransformer.capabilities[spec.tool]) return;
    const { tool: _tool, ...opt } = spec;
    return file.url({ w: box.width, h: box.height, max: true, dpr: 2, ...opt, grant });
}

/** The preview as an image, its box reserved; empty if the file has none. */
export async function thumb(file: any, { alt = "", ...options }: ThumbOptions & { alt?: string } = {}) {
    const src = file && await thumbUrl(file, options);
    const size = options.size ?? "small", box = THUMB_SIZES[size];
    return src ? html`<img class="cms-thumb${size === "small" ? "" : " -" + size}" src="${src}" width=${box.width} height=${box.height} alt="${alt}" loading=lazy>` : "";
}

/** Files keyed by slot name; empty slots are `{ placeholder: true }`. Order is the file order.
 *  `thumb` is the preview size the caller wants; without it none is built. */
export async function nodeFilesJson(node: Node, thumbSize?: ThumbSize): Promise<Record<string, any>> {
    const files = await node.files();
    const all = await node.filesAndPlaceholders();
    const res: Record<string, any> = {};
    for (const [slot, file] of all) {
        if (!files.has(slot)) { res[slot] = { placeholder: true }; continue; }
        const info: Record<string, any> = { name: file.name, mime: file.mime, size: file.vs?.size, url: await file.url() };
        if (file.extension) info.ext = file.extension;
        const thumb = thumbSize && await thumbUrl(file, { size: thumbSize });
        if (thumb) info.thumb = thumb;
        res[slot] = info;
    }
    return res;
}

export function nodeFileAdd(node: Node, file: any, slot?: string): Promise<{ url: string; name: string }> {
    return getCtx().app.db.transaction(() => nodeFileAddTx(node, file, slot));
}
async function nodeFileAddTx(node: Node, file: any, slot?: string): Promise<{ url: string; name: string }> {
    const ctx = getCtx();
    let added: any;
    if (typeof file === "number" || (typeof file === "string" && !isNaN(Number(file)))) {
        const dbF = await ctx.app.dbFiles.file(Number(file));
        if (!await dbF.access()) throw new AccessError("Forbidden");
        if (slot) {
            const existing = await node.file(slot);
            added = await dbF.clone(existing?.id);
        } else {
            added = await node.addFile(await dbF.clone());
        }
    } else {
        if (file != null && !/^(https?|data):/.test(String(file))) {
            throw new AccessError("Forbidden");
        }
        added = await node.addFile(file, slot);
    }
    return { url: await added?.url() ?? "", name: added?.name ?? "" };
}

export async function filesSetOrder(node: any, by: string): Promise<void> {
    const db  = getCtx().app.db;
    const nid = String(node.id);
    let sorted: string[];
    if (by === "name" || by === "name_reverse") {
        const rows = await db.query`SELECT pf.name, f.name AS fname FROM file f, page_file pf WHERE f.id = pf.file_id AND pf.page_id = ${nid} ORDER BY f.name`;
        const vs: Record<string, string> = {};
        for (const row of rows) vs[row.name] = row.fname;
        if (by === "name_reverse") for (const n in vs) vs[n] = String(vs[n] ?? '').split("").reverse().join("");
        sorted = Object.keys(vs).sort((a, b) =>
            vs[a].localeCompare(vs[b], undefined, { numeric: true, sensitivity: "base" }),
        );
    } else {
        const order = by === "date" ? sql`f.log_id` : sql`pf.sort DESC`;
        sorted = await db.col<string>`SELECT pf.name FROM file f, page_file pf WHERE f.id = pf.file_id AND pf.page_id = ${nid} ORDER BY ${order}`;
    }
    await node.sortFiles(sorted);
}

/** Strip leading/trailing slashes, like `ctx.req.appPath`. */
export const cleanRequest = (v: string): string => String(v ?? "").trim().replace(/^\/+|\/+$/g, "");

/** Whether a page url or a redirect answers this request. */
export async function requestUsed(v: string): Promise<boolean> {
    v = cleanRequest(v);
    return !!await getCtx().app.db.one`SELECT 1 FROM page_redirect WHERE request = ${v} UNION ALL SELECT 1 FROM page_url WHERE url = ${v} LIMIT 1`;
}

export async function searchNodes(search: string): Promise<any[]> {
    const ctx = getCtx(), sh = sqlSearch(search.replace(/^cmspid:\/\//, ""), ["t.text"], { exact: ["p.id"] });
    const ids = await ctx.app.db.col<number>`
        SELECT p.id FROM page p JOIN text_lang t ON p.title_id = t.text_id
        WHERE (p.type = 'p' OR p.visible) AND ${sh.where}
        ORDER BY ${sh.order}, t.lang = ${ctx.lang} DESC, t.text ASC LIMIT 60`;
    const res = [], cmsApp = cms(ctx.app);
    for (const pid of new Set(ids.map(Number))) {
        const page = await cmsApp.node(pid);
        if (!await page.access()) continue;
        const title = (await page.showTitle()).plain();
        if (!title) continue;
        const parent = await page.parent(), gp = await parent?.parent();
        const sub = (await Promise.all([parent, gp].filter((n): n is Node => !!n).map(async (n) => (await n.showTitle()).plain())))
            .filter((t, i) => i === 0 || t).map((t) => `<i style="font-size:10px;display:block">${hee(t)}</i>`).join("");
        res.push({
            html: `<b>${hee(title)}</b> (${page.vs?.type === "c" ? "Content" : "Page"} ${page.id})${sub}`,
            text: `${title} (${page.id})`,
            value: page.id,
        });
        if (res.length >= 20) break;
    }
    return res;
}

export async function searchFiles(s: string): Promise<any[]> {
    const ctx = getCtx();
    const db  = ctx.app.db;
    const id  = /^\d+$/.test(s) ? Number(s) : 0;
    const res = [];
    const used = new Set<string>();
    // file contents live in the fulltext-indexed `text` column; only MySQL can use that index
    const inText = db.dialect === "mysql"
        ? sql`MATCH(f.text) AGAINST (${s + "*"} IN BOOLEAN MODE)`
        : sql`f.text LIKE ${"%" + s + "%"}`;
    for (const vs of await db.query`
        SELECT pf.page_id AS pid, f.*
        FROM page_file pf, file f WHERE true AND pf.file_id = f.id
        AND ( f.id = ${id} OR f.name LIKE ${"%" + s + "%"} OR ${inText} )
        ORDER BY f.id = ${id} DESC, f.name = ${s} DESC, f.name LIKE ${s + "%"} DESC,
        f.name LIKE ${"% " + s + "%"} DESC, ${inText} DESC, f.name ASC
        LIMIT 100`) { // the loop keeps 10 after access checks; this caps the work
        const node = await cms(ctx.app).node(vs.pid);
        if (await node.access() < 2) continue;
        const dbFile = await ctx.app.dbFiles.file(vs.id, vs);
        if (!await dbFile.exists()) continue;
        const md5 = vs.md5;
        if (md5 && used.has(md5)) continue;
        if (res.length >= 10) break;
        if (md5) used.add(md5);
        const imgSrc = await thumbUrl(dbFile) ?? "about:blank";
        res.push({
            html:  `<div style="background:url(${hee(imgSrc)}) center/contain no-repeat; width:2rem; height:2rem; float:left; display:block; margin-right:.1875rem"></div>` +
                   `<b>${hee(vs.name)}</b><br><i>${hee(await (await node.page()).showTitle())}</i>`,
            text:  vs.name,
            value: dbFile.id,
        });
    }
    return res;
}
