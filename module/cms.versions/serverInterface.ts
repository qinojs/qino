// deno-lint-ignore-file no-explicit-any
import { cms, describeChange } from "../cms/mod.ts";
import { sql, hee, type Sql } from "../core/mod.ts";
import { versedTables, view } from "./lib/Vers.ts";
import { getCmsVers, copyNode } from "./lib/CmsVers.ts";

export async function publishNode(ctx: any, pid: any, options: any = {}): Promise<any> {
    const id = Number(pid);
    const page = await cms(ctx.app).node(id);
    if (await page.access() < 2) return false;
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
    const page = await cms(ctx.app).node(Number(pid));
    if (await page.access() < 2) return [];
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
    const contOrPage = async (page: any): Promise<string> => {
        const title = (await (await page.title())?.string?.() ?? "").trim();
        return `${page.vs?.type === "p" ? await t`page` : await t`Content`} ${title ? `"${hee(title)}" ` : ""}(${page.id})`;
    };

    const changed = await ctx.app.db.query`SELECT node_id, page_id, data FROM node_changed WHERE log_id = ${id} ORDER BY id`;
    const access: Record<number, number> = {};
    const messages = [];
    for (const c of changed) {
        const pageId = Number(c.page_id);
        access[pageId] ??= await (await cms(ctx.app).node(pageId)).access();
        if (access[pageId] < 2) continue;
        const p = await cms(ctx.app).node(Number(c.node_id));
        // the whole message is the hover target for highlighting the node in the preview
        messages.push(`<div mark="[qcms-id='${p.id}']">${await contOrPage(p)} ${await describeChange(c.data, t)}</div>`);
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

// ─── Protocol helpers ────────────────────────────────────────────────────────

async function versProtocolForNodeTree(ctx: any, pid: number): Promise<any[]> {
    const page = await cms(ctx.app).node(pid);
    const conts = await page.conts();
    const [data, ...subs] = await Promise.all([
        versProtocolForNode(ctx, pid),
        ...conts.map((cont: any) => versProtocolForNodeTree(ctx, cont.id)),
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
    const db = ctx.app.db;
    if (!versedTables(db)[table]) return [];
    const rows = await db.query`
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
