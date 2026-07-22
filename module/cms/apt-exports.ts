// deno-lint-ignore-file no-explicit-any
import { getCtx, hee, Output, sql, unixTime } from "../core/mod.ts";
import { cms, type Node } from "./mod.ts";
// ─── business logic used by REST ──────────────

export async function nodeToJson(node: Node, type = "*"): Promise<any> {
    const title = await node.showTitle();
    const access = await node.access();
    return {
        id:          node.id,
        title:       access ? (String(title).trim() || "-") : "(no access)",
        title_id:    title.id,
        numChildren: (await node.children({ type })).size,
        url:         await node.url(),
        myaccess:    access,
        visible:     Number(node.vs?.["visible"] ?? 0),
        online:      (await node.isOnline()) ? 1 : 0,
        public:      (await node.isPublic()) ? 1 : 0,
        type:        node.vs.type,
        module:      node.vs.module,
        name:        String(node.vs.name ?? ""),
    };
}

// Shared recursive tree serializer over node.children(); self = start with the node itself instead of its children.
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
    const res: any[] = [];
    for (const n of nodes) {
        if ((await n.access()) < (opts.access ?? 1)) continue;
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
    const In = opt.in ? await cms(ctx.app).node(opt.in) : null;
    const self = String(start) === "0";
    return treeToJson({
        node: await cms(ctx.app).node(self ? 1 : start),
        self,
        type: filter,
        access: 0, // no-access nodes stay listed, nodeToJson masks their title
        entry: (n: Node) => nodeToJson(n, filter),
        expand: async (n: Node, level: number) => (!In || await In.in(n)) && (!opt.level || opt.level > level),
        emptyChildren: true,
    });
}

export function nodeRemove(node: any): Promise<{ parent_id: number }> {
    return getCtx().app.db.transaction(() => nodeRemoveTx(node));
}
async function nodeRemoveTx(node: any): Promise<{ parent_id: number }> {
    const ctx  = getCtx();
    const ret  = { parent_id: Number(await node.parent()) };
    const trash = Number(await ctx.app.settings.cms.pageTrash ?? 0);
    if (await node.in(trash)) {
        if (await node.access() < 3) throw new Output({ error: "Forbidden" }, { status: 403 });
        await (await node.parent()).removeChild(node);
    } else {
        const TrashNode = await cms(ctx.app).node(trash);
        const parent = await node.parent();
        const siblings = parent ? [...(await parent.children({ type: node.vs.type })).values()] : [];
        const idx = siblings.findIndex(s => s.id === node.id);
        const before = siblings[idx + 1] ?? null;
        await TrashNode.insertBefore(node, await TrashNode.cont("main"));
        node.settings["__deleted_from"]   = String(parent ?? "");
        node.settings["__deleted_before"] = String(before ?? "");
        node.settings["__deleted_time"]   = String(unixTime());
        node.settings["__deleted_by"]     = String(await ctx.user?.get("email") ?? "");
        const bough = await node.bough();
        for (const Child of bough.values()) {
            if (Child.vs?.["access"] !== null) await Child.set("access", 0);
            await ctx.app.db.exec`DELETE FROM page_access_usr WHERE page_id = ${String(Child)} AND access < 2`;
            await ctx.app.db.exec`DELETE FROM page_access_grp WHERE page_id = ${String(Child)} AND access < 2`;
        }
    }
    return ret;
}

export function nodeRestore(node: any): Promise<{ url: string }> {
    return getCtx().app.db.transaction(() => nodeRestoreTx(node));
}
async function nodeRestoreTx(node: any): Promise<{ url: string }> {
    const ctx   = getCtx();
    const trash = Number(await ctx.app.settings.cms.pageTrash ?? 0);
    if (!await node.in(trash)) throw new Output({ error: "Node is not in trash" }, { status: 400 });
    if (await node.access() < 2) throw new Output({ error: "Forbidden" }, { status: 403 });
    const fromId   = Number(await node.settings["__deleted_from"]);
    const beforeId = Number(await node.settings["__deleted_before"]);
    const toNode   = fromId ? await cms(ctx.app).node(fromId) : null;
    if (!toNode || await toNode.access() < 2) throw new Output({ error: "Original parent no longer accessible" }, { status: 403 });
    const before = beforeId ? await cms(ctx.app).node(beforeId) : null;
    await toNode.insertBefore(node, before);
    delete node.settings["__deleted_from"];
    delete node.settings["__deleted_before"];
    delete node.settings["__deleted_time"];
    delete node.settings["__deleted_by"];
    return { url: await node.url() };
}

export function nodeFileAdd(node: Node, file: any, replace?: any): Promise<{ url: string; name: string }> {
    return getCtx().app.db.transaction(() => nodeFileAddTx(node, file, replace));
}
async function nodeFileAddTx(node: Node, file: any, replace?: any): Promise<{ url: string; name: string }> {
    const ctx = getCtx();
    let File: any;
    if (typeof file === "number" || (typeof file === "string" && !isNaN(Number(file)))) {
        const dbF = await ctx.app.dbFiles.file(Number(file));
        if (!await dbF.access()) throw new Output({ error: "Forbidden" }, { status: 403 });
        if (replace) {
            const existing = await node.file(replace);
            File = await dbF.clone(existing?.id);
        } else {
            File = await node.addFile(await dbF.clone());
        }
    } else {
        if (file != null && !/^https?:\/\//.test(String(file))) {
            throw new Output({ error: "Forbidden" }, { status: 403 });
        }
        File = await node.addFile(file, replace);
    }
    return { url: await File?.url() ?? "", name: File?.name ?? "" };
}

export async function filesSetOrder(node: any, by: string): Promise<void> {
    const db  = getCtx().app.db;
    const nid = String(node.id);
    let sorted: string[];
    if (by === "name" || by === "name_reverse") {
        const rows = await db.query`SELECT pf.name, f.name AS fname FROM file f, page_file pf WHERE f.id = pf.file_id AND pf.page_id = ${nid} ORDER BY f.name`;
        const vs: Record<string, string> = {};
        for (const row of rows) vs[row["name"]] = row["fname"];
        if (by === "name_reverse") for (const n in vs) vs[n] = String(vs[n] ?? '').split("").reverse().join("");
        sorted = Object.keys(vs).sort((a, b) =>
            vs[a].localeCompare(vs[b], undefined, { numeric: true, sensitivity: "base" }),
        );
    } else {
        const order = by === "date" ? sql`f.log_id` : sql`pf.sort DESC`;
        sorted = (await db.query`SELECT pf.name FROM file f, page_file pf WHERE f.id = pf.file_id AND pf.page_id = ${nid} ORDER BY ${order}`).map((r: any) => r["name"]);
    }
    await node.sortFiles(sorted);
}

export async function requestUsed(v: string): Promise<boolean> {
    const db = getCtx().app.db;
    const r  = await db.one`SELECT count(*) FROM page_redirect WHERE request = ${v}`;
    const u  = await db.one`SELECT count(*) FROM page_url WHERE url = ${v}`;
    return !!(r || u);
}

export async function searchNodes(search: string): Promise<any[]> {
    const ctx = getCtx();
    search = search.replace(/^cmspid:\/\//, "");
    const res: any[] = [];
    for (const vs of await ctx.app.db.query`
        SELECT p.id AS id FROM page p, text t WHERE true
        AND ( p.type = 'p' OR p.visible ) AND p.title_id = t.id
        AND ( p.id = ${search} OR t.text LIKE ${"%" + search + "%"} ) GROUP BY p.id ORDER BY
        p.id = ${search} DESC, t.lang = ${ctx.lang} DESC,
        t.text = ${search} DESC, t.text LIKE ${search + "%"} DESC, t.text LIKE ${"% " + search + "%"} DESC, t.text ASC LIMIT 20`) {
        const Page = await cms(ctx.app).node(vs.id);
        if (!await Page.access()) continue;
        const titleStr = String(await Page.showTitle()).trim();
        if (!titleStr) continue;
        const parent   = await Page.parent();
        const pTitle   = parent ? String(await parent.showTitle()).trim() : "";
        const gp       = parent ? await parent.parent() : null;
        const gpTitle  = gp ? String(await gp.showTitle()).trim() : "";
        res.push({
            html:  `<b>${hee(titleStr)}</b> (${Page.vs?.["type"] === "c" ? "Content" : "Page"} ${Page.id})` +
                   (parent ? `<i style="font-size:10px;display:block">${hee(pTitle)}</i>` + (gpTitle ? `<i style="font-size:10px;display:block">${hee(gpTitle)}</i>` : "") : ""),
            text:  titleStr ? `${hee(titleStr)} (${Page.id})` : String(Page.id),
            value: Page.id,
        });
    }
    return res;
}

export async function searchFiles(search: string): Promise<any[]> {
    const ctx = getCtx();
    const db  = ctx.app.db;
    const s   = search;
    const res: any[] = [];
    let i = 0;
    const used: Record<string, boolean> = {};
    for (const vs of await db.query`
        SELECT pf.page_id AS pid, f.*
        FROM page_file pf, file f WHERE true AND pf.file_id = f.id
        AND ( f.id = ${s} OR f.name LIKE ${"%" + s + "%"} OR f.text LIKE ${s + "%"} )
        ORDER BY f.id = ${s} DESC, f.name = ${s} DESC, f.name LIKE ${s + "%"} DESC,
        f.name LIKE ${"% " + s + "%"} DESC, f.text = ${s} DESC, f.text LIKE ${s + "%"} DESC, f.name ASC`) {
        const node = await cms(ctx.app).node(vs["pid"]);
        if ((await node.access()) < 2) continue;
        const F = await ctx.app.dbFiles.file(vs.id, vs);
        if (!await F.exists()) continue;
        const md5 = vs["md5"];
        if (md5 && used[md5]) continue;
        if (i++ > 10) break;
        if (md5) used[md5] = true;
        const isImg = ["jpg", "jpeg", "gif", "svg", "png"].includes(F.extension);
        const imgSrc = isImg ? await F.url({w: 32, h: 32}) : "about:blank";
        res.push({
            html:  `<div style="background:url(${hee(imgSrc)}) no-repeat center; width:32px; height:32px; float:left; display:block; margin-right:3px"></div>` +
                   `<b>${hee(vs["name"])}</b><br><i>${hee(await (await node.page()).showTitle())}</i>`,
            text:  vs["name"],
            value: F.id,
        });
    }
    return res;
}
