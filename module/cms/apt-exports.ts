// deno-lint-ignore-file no-explicit-any
import { getCtx, hee, Output, sql } from "../core/mod.ts";
import type { Node } from "./mod.ts";
// ─── business logic used by REST ──────────────

export async function nodeToJson(nid: any, type = "*"): Promise<any> {
    const app = getCtx().app.cms;
    const Page = await app.node(nid);
    const titleObj = await Page.title();
    const titleStr = String(await titleObj.string() ?? "").trim();
    return {
        id:          Number(Page.id),
        title:       (await Page.access()) ? (titleStr || "-") : "(no access)",
        title_id:    titleObj.id,
        numChildren: (await Page.children({ type }))?.size ?? 0,
        url:         await Page.url(),
        myaccess:    await Page.access(),
        visible:     Number(Page.vs?.["visible"] ?? 0),
        online:      (await Page.isOnline()) ? 1 : 0,
        public:      (await Page.isPublic()) ? 1 : 0,
        type:        Page.vs.type,
        module:      Page.vs.module,
        name:        String(Page.vs.name ?? ""),
    };
}

export async function cmsGetTree(start: any, opt: any = {}): Promise<any[]> {
    const ctx = getCtx();
    const filter = opt["filter"] ?? "*";
    const level  = (opt["_level"] ?? 0) + 1;
    const res: any[] = [];
    let Cs: any[];
    if (String(start) === "0") {
        Cs = [await ctx.app.cms.node(1)];
    } else {
        const P = await ctx.app.cms.node(start);
        Cs = [...(await P.children({ type: filter })).values()];
    }
    for (const C of Cs) {
        const node: any = await nodeToJson(C.id, filter);
        const shouldExpand =
            (!opt["in"] || await (await ctx.app.cms.node(opt["in"])).in(C)) &&
            (!opt["level"] || opt["level"] > level);
        if (shouldExpand) {
            node["children"] = await cmsGetTree(C.id, { ...opt, _level: level });
        }
        res.push(node);
    }
    return res;
}

export async function nodeRemove(node: any): Promise<{ parent_id: number }> {
    const ctx  = getCtx();
    const ret  = { parent_id: Number(await node.parent()) };
    const trash = Number(await ctx.app.settings.cms.pageTrash ?? 0);
    if (await node.in(trash)) {
        if (await node.access() < 3) throw new Output({ error: "Forbidden" }, { status: 403 });
        await (await node.parent()).removeChild(node);
    } else {
        const TrashNode = await ctx.app.cms.node(trash);
        const parent = await node.parent();
        const siblings = parent ? [...(await parent.children({ type: node.vs.type })).values()] : [];
        const idx = siblings.findIndex(s => s.id === node.id);
        const before = siblings[idx + 1] ?? null;
        await TrashNode.insertBefore(node, await TrashNode.cont("main"));
        node.settings["__deleted_from"]   = String(parent ?? "");
        node.settings["__deleted_before"] = String(before ?? "");
        node.settings["__deleted_time"]   = String(Math.floor(Date.now() / 1000));
        node.settings["__deleted_by"]     = String(await ctx.user?.get("email") ?? "");
        const bough = await node.bough();
        for (const Child of bough.values()) {
            if (Child.vs?.["access"] !== null) await Child.set("access", 0);
            await ctx.app.db.query`DELETE FROM page_access_usr WHERE page_id = ${String(Child)} AND access < 2`;
            await ctx.app.db.query`DELETE FROM page_access_grp WHERE page_id = ${String(Child)} AND access < 2`;
        }
    }
    return ret;
}

export async function nodeRestore(node: any): Promise<{ url: string }> {
    const ctx   = getCtx();
    const trash = Number(await ctx.app.settings.cms.pageTrash ?? 0);
    if (!await node.in(trash)) throw new Output({ error: "Node is not in trash" }, { status: 400 });
    if (await node.access() < 2) throw new Output({ error: "Forbidden" }, { status: 403 });
    const fromId   = Number(await node.settings["__deleted_from"]   ?? 0);
    const beforeId = Number(await node.settings["__deleted_before"] ?? 0);
    const ToNode   = fromId ? await ctx.app.cms.node(fromId) : null;
    if (!ToNode || !await ToNode.access()) throw new Output({ error: "Original parent no longer accessible" }, { status: 403 });
    const before = beforeId ? await ctx.app.cms.node(beforeId) : null;
    await ToNode.insertBefore(node, before);
    delete node.settings["__deleted_from"];
    delete node.settings["__deleted_before"];
    delete node.settings["__deleted_time"];
    delete node.settings["__deleted_by"];
    return { url: await node.url() };
}

export async function nodeFileAdd(node: Node, file: any, replace?: any): Promise<{ url: string; name: string }> {
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
        const rows = await db.all`SELECT pf.name, f.name AS fname FROM file f, page_file pf WHERE f.id = pf.file_id AND pf.page_id = ${nid} ORDER BY f.name`;
        const vs: Record<string, string> = {};
        for (const row of rows) vs[row["name"]] = row["fname"];
        if (by === "name_reverse") for (const n in vs) vs[n] = String(vs[n] ?? '').split("").reverse().join("");
        sorted = Object.keys(vs).sort((a, b) =>
            vs[a].localeCompare(vs[b], undefined, { numeric: true, sensitivity: "base" }),
        );
    } else {
        const order = by === "date" ? sql`f.log_id` : sql`pf.sort DESC`;
        sorted = (await db.all`SELECT pf.name FROM file f, page_file pf WHERE f.id = pf.file_id AND pf.page_id = ${nid} ORDER BY ${order}`).map((r: any) => r["name"]);
    }
    await node.sortFiles(sorted);
}

export async function cmsRequestUsed(v: string): Promise<boolean> {
    const db = getCtx().app.db;
    const r  = await db.one`SELECT count(*) FROM page_redirect WHERE request = ${v}`;
    const u  = await db.one`SELECT count(*) FROM page_url WHERE url = ${v}`;
    return !!(r || u);
}

export async function cmsSearchNodes(search: string): Promise<any[]> {
    const ctx = getCtx();
    search = search.replace(/^cmspid:\/\//, "");
    const res: any[] = [];
    for (const vs of await ctx.app.db.all`
        SELECT p.id AS id FROM page p, text t WHERE true
        AND ( p.type = 'p' OR p.visible ) AND p.title_id = t.id
        AND ( p.id = ${search} OR t.text LIKE ${"%" + search + "%"} ) GROUP BY p.id ORDER BY
        p.id = ${search} DESC, t.lang = ${ctx.lang} DESC,
        t.text = ${search} DESC, t.text LIKE ${search + "%"} DESC, t.text LIKE ${"% " + search + "%"} DESC, t.text ASC LIMIT 20`) {
        const Page = await ctx.app.cms.node(vs.id);
        if (!await Page.access()) continue;
        const titleStr = String(await (await Page.title()).string() ?? "").trim();
        if (!titleStr) continue;
        const parent   = await Page.parent();
        const pTitle   = parent ? String(await (await parent.title()).string() ?? "").trim() : "";
        const gp       = parent ? await parent.parent() : null;
        const gpTitle  = gp ? String(await (await gp.title()).string() ?? "").trim() : "";
        res.push({
            html:  `<b>${hee(titleStr)}</b> (${Page.vs?.["type"] === "c" ? "Content" : "Page"} ${Page.id})` +
                   (parent ? `<i style="font-size:10px;display:block">${hee(pTitle)}</i>` + (gpTitle ? `<i style="font-size:10px;display:block">${hee(gpTitle)}</i>` : "") : ""),
            text:  titleStr ? `${hee(titleStr)} (${Page.id})` : String(Page.id),
            value: Page.id,
        });
    }
    return res;
}

export async function cmsSearchFiles(search: string): Promise<any[]> {
    const ctx = getCtx();
    const db  = ctx.app.db;
    const s   = search;
    const res: any[] = [];
    let i = 0;
    const used: Record<string, boolean> = {};
    for (const vs of await db.all`
        SELECT pf.page_id AS pid, f.*
        FROM page_file pf, file f WHERE true AND pf.file_id = f.id
        AND ( f.id = ${s} OR f.name LIKE ${"%" + s + "%"} OR f.text LIKE ${s + "%"} )
        ORDER BY f.id = ${s} DESC, f.name = ${s} DESC, f.name LIKE ${s + "%"} DESC,
        f.name LIKE ${"% " + s + "%"} DESC, f.text = ${s} DESC, f.text LIKE ${s + "%"} DESC, f.name ASC`) {
        const node = await ctx.app.cms.node(vs["pid"]);
        if ((await node.access()) < 2) continue;
        const F = await ctx.app.dbFiles.file(vs.id, vs);
        if (!await F.exists()) continue;
        const md5 = vs["md5"];
        if (md5 && used[md5]) continue;
        if (i++ > 10) break;
        if (md5) used[md5] = true;
        const ext   = F.extension;
        const isImg = ["jpg", "jpeg", "gif", "svg", "png"].includes(ext);
        const imgSrc = isImg ? await F.url({w: 32, h: 32}) : "about:blank";
        res.push({
            html:  `<div style="background:url(${hee(imgSrc)}) no-repeat center; width:32px; height:32px; float:left; display:block; margin-right:3px"></div>` +
                   `<b>${hee(vs["name"])}</b><br><i>${hee(await (await (await node.page()).title()).string() ?? "")}</i>`,
            text:  vs["name"],
            value: F.id,
        });
    }
    return res;
}
