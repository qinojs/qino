/**
 * cms.versions/serverInterface.ts
 * Port of cms.versions/serverInterface.php
 */

// deno-lint-ignore-file no-explicit-any

import { versedTables, view, getCmsVers } from "./lib/Vers.ts";
import { publishCont as doPublishCont } from "./lib/CmsVers.ts";

export async function publishCont(ctx: any, pid: any, options: any = {}): Promise<any> {
    const id = parseInt(String(pid));
    const Page = await ctx.app.cms.node(id);
    if ((await Page.access()) < 2) return false;
    const cmsVersSpace = getCmsVers(ctx).cmsVersSpace;
    options = {
        fromSpace: cmsVersSpace,
        fromLog:   0,
        toSpace:   cmsVersSpace,
        subPages:  false,
        ...options,
    };
    await doPublishCont(ctx.app.db, id, options.fromSpace, options.fromLog, options.toSpace, options.subPages);
}

export async function getForPage(ctx: any, pid: any): Promise<any[]> {
    const data = await versProtocolForPageAndConts(ctx, parseInt(String(pid)));
    const map: Record<number, any> = {};
    for (const row of data) map[row.vers] = row;
    return Object.values(map).sort((a, b) => a.vers - b.vers);
}

export async function logDetails(ctx: any, id: any): Promise<any> {
    id = parseInt(String(id));
    const row = await ctx.app.db.row(
        " SELECT log.time, log.post, log_ip.ip, log_user_agent.user_agent, usr.email " +
        " FROM log " +
        "   LEFT JOIN log_ip           ON log.ip_id         = log_ip.id " +
        "   LEFT JOIN log_user_agent   ON log.user_agent_id = log_user_agent.id " +
        "   LEFT JOIN sess             ON log.sess_id       = sess.id " +
        "   LEFT JOIN usr              ON sess.usr_id       = usr.id " +
        " WHERE log.id = ?",
        [id]
    );
    if (!row) return null;

    const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
    const post = safeJson(String(row.post || "{}"));
    const data = safeJson(post.askJSON ?? "{}");

    const translateFn: Record<string, string> = {
        "page::addContent":        "Inhalt hinzugefügt",
        "page::insertBefore":      "Position geändert",
        "page::setDefault":        "Einstellung geändert",
        "page::setDefaultById":    "Einstellung geändert",
        "page::FilesSort":         "Dateireihenfolge geändert",
        "page::filesSetOrder":     "Dateien sortiert",
        "page::FileAdd":           "Datei hinzugefügt",
        "page::FileDelete":        "Datei gelöscht",
        "page::filesDeleteDouble": "Doppelte Dateien gelöscht",
        "page::copy":              "Kopiert",
        "page::remove":            "Gelöscht",
        "page::setModule":         "Modul geändert",
        "page::addClass":          "Tag hinzugefügt",
        "page::removeClass":       "Tag entfernt",
        "page::setVisible":        "Sichtbarkeit geändert",
        "cms_vers::rollBackCont":  "Stand zurückgesetzt",
        "SettingsEditor::set":     "Einstellung geändert",
        "Setting":                 "Einstellung geändert",
    };
    const ignoreFn: Record<string, 1> = {
        "cms_frontend_1::widget": 1,
        "cms::getTree":           1,
        "page::get":              1,
        "page::getWithHead":      1,
        "page::reload":           1,
        "page::setPublic":        1,
        "page::onlineStart":      1,
        "page::onlineEnd":        1,
    };

    const contOrPage = async (Page: any): Promise<string> => {
        const titleObj = await Page.title();
        const title = (await titleObj?.string?.() ?? "").trim();
        const label = `${Page.vs?.type === "p" ? "Seite" : "Inhalt"} ${title ? `"${title}" ` : ""}(${Page.id})`;
        return `<div mark=".-pid${Page.id}">${label}</div>`;
    };

    const messages: string[] = [];
    if (data.serverInterface) {
        for (const call of Object.values(data.serverInterface) as any[]) {
            const fn   = call.fn;
            const args = call.args ?? [];
            if (ignoreFn[fn]) continue;
            if (fn === "cms::setTxt") {
                const vs = await ctx.app.db.row(
                    `SELECT name, page_id FROM _vers_page_text WHERE text_id = ? AND _vers_space = ?`,
                    [parseInt(args[0]), getCmsVers(ctx).cmsVersSpace]
                ) ?? await ctx.app.db.row(
                    `SELECT name, page_id FROM page_text WHERE text_id = ?`, [parseInt(args[0])]
                );
                if (vs) {
                    const P = await ctx.app.cms.node(vs.page_id);
                    messages.push((await contOrPage(P)) + ` Text "${vs.name}" geändert`);
                } else {
                    const vs2 = await ctx.app.db.row(
                        `SELECT id FROM page WHERE title_id = ?`, [parseInt(args[0])]
                    );
                    if (vs2) {
                        const P = await ctx.app.cms.node(vs2.id);
                        messages.push((await contOrPage(P)) + " Titel geändert");
                    }
                }
            } else if (fn === "page::insertBefore") {
                const P = await ctx.app.cms.node(args[1]);
                messages.push((await contOrPage(P)) + " " + translateFn[fn]);
            } else if (translateFn[fn]) {
                const P = await ctx.app.cms.node(args[0]);
                messages.push((await contOrPage(P)) + " " + translateFn[fn]);
            } else {
                messages.push(`<span style="color:red">${fn}</span>`);
            }
        }
    }

    return {
        messages,
        usr:     row.email ?? "guest",
        ip:      row.ip ?? "",
        browser: row.user_agent ?? "",
        time:    parseInt(String(row.time ?? 0)),
    };
}


// ─── Protocol helpers ────────────────────────────────────────────────────────

async function versProtocolForPageAndConts(ctx: any, pid: number): Promise<any[]> {
    const P = await ctx.app.cms.node(pid);
    const conts = await P.Conts?.() ?? [];
    const [data, ...subs] = await Promise.all([
        versProtocolForPage(ctx, pid),
        ...conts.map((C: any) => versProtocolForPageAndConts(ctx, C.id)),
    ]);
    return [...data, ...subs.flat()];
}

async function versProtocolForPage(ctx: any, pid: number): Promise<any[]> {
    const space = getCmsVers(ctx).cmsVersSpace;
    const spaceView = (t: string) => view(ctx.app.db, t, space, 0);

    const results = await Promise.all([
        versProtocol(ctx, "page",      `t.id = ${pid}`),
        versProtocol(ctx, "page_text", `t.page_id = ${pid}`),
        spaceView("page").then(v => versProtocol(ctx, "text", `t.id = (SELECT title_id FROM \`${v}\` WHERE id = ${pid})`)),
        spaceView("page_text").then(v => versProtocol(ctx, "text", `t.id IN(SELECT text_id FROM \`${v}\` WHERE page_id = ${pid})`)),
        spaceView("page_file").then(v => versProtocol(ctx, "file", `t.id IN(SELECT file_id FROM \`${v}\` WHERE page_id = ${pid})`)),
    ]);
    return results.flat();
}

async function versProtocol(ctx: any, table: string, where: string): Promise<any[]> {
    if (!versedTables[table]) return [];
    const sql =
        `SELECT t._vers_log, l.time, l.sess_id, usr.id as usr_id, usr.email ` +
        `FROM \`_vers_${table}\` t ` +
        `LEFT JOIN log l ON t._vers_log = l.id ` +
        `LEFT JOIN sess  ON l.sess_id = sess.id ` +
        `LEFT JOIN usr   ON sess.usr_id = usr.id ` +
        `WHERE t._vers_space = ? AND t._vers_log > 0 AND ${where} ` +
        `ORDER BY t._vers_log`;
    const rows = await ctx.app.db.all(sql, [getCmsVers(ctx).cmsVersSpace]);
    return rows.map((r: any) => ({
        vers: r._vers_log,
        time: parseInt(String(r.time ?? 0)),
        usr:  r.usr_id ? r.email : "guest",
    }));
}
