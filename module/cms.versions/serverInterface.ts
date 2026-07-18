// deno-lint-ignore-file no-explicit-any
import { cms } from "../cms/mod.ts";
import { sql, hee, type Sql } from "../core/mod.ts";
import { versedTables, view } from "./lib/Vers.ts";
import { getCmsVers, copyNode } from "./lib/CmsVers.ts";

export async function publishNode(ctx: any, pid: any, options: any = {}): Promise<any> {
    const id = Number(pid);
    const Page = await cms(ctx.app).node(id);
    if ((await Page.access()) < 2) return false;
    const cmsVersSpace = getCmsVers(ctx).space;
    options = {
        fromSpace: cmsVersSpace,
        fromLog:   0,
        toSpace:   cmsVersSpace,
        subPages:  false,
        ...options,
    };
    await copyNode(ctx.app.db, id, options.fromSpace, options.fromLog, options.toSpace, options.subPages);
}

export async function getForNode(ctx: any, pid: any): Promise<any[]> {
    const Page = await cms(ctx.app).node(Number(pid));
    if ((await Page.access()) < 2) return [];
    const data = await versProtocolForNodeTree(ctx, Number(pid));
    const map: Record<number, any> = {};
    for (const row of data) map[row.vers] = row;
    return Object.values(map).sort((a, b) => a.vers - b.vers);
}

export async function logDetails(ctx: any, id: any): Promise<any> {
    id = Number(id);
    const row = await ctx.app.db.row`
        SELECT log.time, log_ip.ip, log_user_agent.user_agent, usr.email
        FROM log
          LEFT JOIN log_ip           ON log.ip_id         = log_ip.id
          LEFT JOIN log_user_agent   ON log.user_agent_id = log_user_agent.id
          LEFT JOIN sess             ON log.sess_id       = sess.id
          LEFT JOIN usr              ON sess.usr_id       = usr.id
        WHERE log.id = ${id}`;
    if (!row) return null;

    // One message per node_changed row on a page the caller may edit (>= 2).
    // Edit access on any affected page unlocks the metadata (who/when/ip);
    // rows on unreachable pages are skipped, so no foreign node leaks through.
    // Logs without any editable affected page (or none captured) stay closed.
    const t = ctx.app.t;
    const contOrPage = async (Page: any): Promise<string> => {
        const title = (await (await Page.title())?.string?.() ?? "").trim();
        const label = `${Page.vs?.type === "p" ? await t`Page` : await t`Content`} ${title ? `"${hee(title)}" ` : ""}(${Page.id})`;
        return `<div mark="[qcms-id='${Page.id}']">${label}</div>`;
    };

    const changed = await ctx.app.db.query`SELECT node_id, page_id, data FROM node_changed WHERE log_id = ${id} ORDER BY id`;
    const access: Record<number, number> = {};
    const messages: string[] = [];
    for (const c of changed) {
        const pageId = Number(c.page_id);
        access[pageId] ??= await (await cms(ctx.app).node(pageId)).access();
        if (access[pageId] < 2) continue;
        const P = await cms(ctx.app).node(Number(c.node_id));
        messages.push((await contOrPage(P)) + " " + await describeChange(c.data, t));
    }
    if (!messages.length) return null;

    return {
        messages,
        usr:     row.email ?? "guest",
        ip:      row.ip ?? "",
        browser: row.user_agent ?? "",
        time:    Number(row.time ?? 0),
    };
}

// Human-readable change label from a node_changed `data` payload ({ table, op, name?, cols? }).
async function describeChange(dataStr: any, t: any): Promise<string> {
    let d: any = {};
    try { d = JSON.parse(String(dataStr ?? "{}")); } catch { /* keep {} */ }
    const cols: string[] = Array.isArray(d.cols) ? d.cols : [];
    switch (d.table) {
        case "page":
            if (d.op === "insert") return await t`Created`;
            if (d.op === "delete") return await t`Deleted`;
            if (cols.includes("visible")) return await t`Visibility changed`;
            if (cols.includes("module")) return await t`Module changed`;
            if (cols.includes("sort") || cols.includes("basis")) return await t`Position changed`;
            return await t`Setting changed`;
        case "page_text":
        case "text":
            return d.name ? `${await t`Text`} "${hee(String(d.name))}" ${await t`changed`}` : await t`Text changed`;
        case "page_file":
        case "file":
            return d.op === "delete" ? await t`File deleted` : await t`File added`;
        case "page_url":
            return await t`URL changed`;
        case "page_access_grp":
        case "page_access_usr":
            return await t`Access changed`;
        default:
            return await t`Changed`;
    }
}

// ─── Protocol helpers ────────────────────────────────────────────────────────

async function versProtocolForNodeTree(ctx: any, pid: number): Promise<any[]> {
    const P = await cms(ctx.app).node(pid);
    const conts = await P.conts();
    const [data, ...subs] = await Promise.all([
        versProtocolForNode(ctx, pid),
        ...conts.map((C: any) => versProtocolForNodeTree(ctx, C.id)),
    ]);
    return [...data, ...subs.flat()];
}

async function versProtocolForNode(ctx: any, pid: number): Promise<any[]> {
    const space = getCmsVers(ctx).space;
    const spaceView = (t: string) => view(ctx.app.db, t, space, 0);

    const results = await Promise.all([
        versProtocol(ctx, "page",      sql`t.id = ${pid}`),
        versProtocol(ctx, "page_text", sql`t.page_id = ${pid}`),
        spaceView("page").then(v => versProtocol(ctx, "text", sql`t.id = (SELECT title_id FROM ${sql.id(v)} WHERE id = ${pid})`)),
        spaceView("page_text").then(v => versProtocol(ctx, "text", sql`t.id IN(SELECT text_id FROM ${sql.id(v)} WHERE page_id = ${pid})`)),
        spaceView("page_file").then(v => versProtocol(ctx, "file", sql`t.id IN(SELECT file_id FROM ${sql.id(v)} WHERE page_id = ${pid})`)),
    ]);
    return results.flat();
}

async function versProtocol(ctx: any, table: string, where: Sql): Promise<any[]> {
    if (!versedTables(ctx.app.db)[table]) return [];
    const rows = await ctx.app.db.query`
        SELECT t._vers_log, l.time, l.sess_id, usr.id as usr_id, usr.email
        FROM ${sql.id("_vers_" + table)} t
        LEFT JOIN log l ON t._vers_log = l.id
        LEFT JOIN sess  ON l.sess_id = sess.id
        LEFT JOIN usr   ON sess.usr_id = usr.id
        WHERE t._vers_space = ${getCmsVers(ctx).space} AND t._vers_log > 0 AND ${where}
        ORDER BY t._vers_log`;
    return rows.map((r: any) => ({
        vers: r._vers_log,
        time: Number(r.time ?? 0),
        usr:  r.usr_id ? r.email : "guest",
    }));
}
