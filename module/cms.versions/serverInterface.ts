// deno-lint-ignore-file no-explicit-any

import { versedTables, view } from "./lib/Vers.ts";
import { getCmsVers, copyNode } from "./lib/CmsVers.ts";

export async function publishNode(ctx: any, pid: any, options: any = {}): Promise<any> {
    const id = Number(pid);
    const Page = await ctx.app.cms.node(id);
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
    const data = await versProtocolForNodeTree(ctx, Number(pid));
    const map: Record<number, any> = {};
    for (const row of data) map[row.vers] = row;
    return Object.values(map).sort((a, b) => a.vers - b.vers);
}

export async function logDetails(ctx: any, id: any): Promise<any> {
    id = Number(id);
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

    const t = ctx.app.t.bind(ctx.app.languages);
    const [tContentAdded, tPositionChanged, tSettingChanged, tFileOrderChanged, tFilesSorted, tFileAdded, tFileDeleted, tDuplicatesDeleted, tCopied, tDeleted, tModuleChanged, tTagAdded, tTagRemoved, tVisibilityChanged, tReverted] = await Promise.all([
        t`Content added`, t`Position changed`, t`Setting changed`, t`File order changed`, t`Files sorted`, t`File added`, t`File deleted`, t`Duplicate files deleted`, t`Copied`, t`Deleted`, t`Module changed`, t`Tag added`, t`Tag removed`, t`Visibility changed`, t`Reverted to previous state`,
    ]);
    const translateFn: Record<string, string> = {
        "page::addContent":        tContentAdded,
        "page::insertBefore":      tPositionChanged,
        "page::setDefault":        tSettingChanged,
        "page::setDefaultById":    tSettingChanged,
        "page::FilesSort":         tFileOrderChanged,
        "page::filesSetOrder":     tFilesSorted,
        "page::FileAdd":           tFileAdded,
        "page::FileDelete":        tFileDeleted,
        "page::filesDeleteDouble": tDuplicatesDeleted,
        "page::copy":              tCopied,
        "page::remove":            tDeleted,
        "page::setModule":         tModuleChanged,
        "page::addClass":          tTagAdded,
        "page::removeClass":       tTagRemoved,
        "page::setVisible":        tVisibilityChanged,
        "cms_vers::rollBackCont":  tReverted,
        "SettingsEditor::set":     tSettingChanged,
        "Setting":                 tSettingChanged,
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
        const label = `${Page.vs?.type === "p" ? await t`Page` : await t`Content`} ${title ? `"${title}" ` : ""}(${Page.id})`;
        return `<div mark="[qcms-id='${Page.id}']">${label}</div>`;
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
                    [Number(args[0]), getCmsVers(ctx).space]
                ) ?? await ctx.app.db.row(
                    `SELECT name, page_id FROM page_text WHERE text_id = ?`, [Number(args[0])]
                );
                if (vs) {
                    const P = await ctx.app.cms.node(vs.page_id);
                    messages.push((await contOrPage(P)) + ` ${await t`Text`} "${vs.name}" ${await t`changed`}`);
                } else {
                    const vs2 = await ctx.app.db.row(
                        `SELECT id FROM page WHERE title_id = ?`, [Number(args[0])]
                    );
                    if (vs2) {
                        const P = await ctx.app.cms.node(vs2.id);
                        messages.push((await contOrPage(P)) + " " + await t`Title changed`);
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
        time:    Number(row.time ?? 0),
    };
}

// ─── Protocol helpers ────────────────────────────────────────────────────────

async function versProtocolForNodeTree(ctx: any, pid: number): Promise<any[]> {
    const P = await ctx.app.cms.node(pid);
    const conts = await P.Conts?.() ?? [];
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
        versProtocol(ctx, "page",      `t.id = ${pid}`),
        versProtocol(ctx, "page_text", `t.page_id = ${pid}`),
        spaceView("page").then(v => versProtocol(ctx, "text", `t.id = (SELECT title_id FROM \`${v}\` WHERE id = ${pid})`)),
        spaceView("page_text").then(v => versProtocol(ctx, "text", `t.id IN(SELECT text_id FROM \`${v}\` WHERE page_id = ${pid})`)),
        spaceView("page_file").then(v => versProtocol(ctx, "file", `t.id IN(SELECT file_id FROM \`${v}\` WHERE page_id = ${pid})`)),
    ]);
    return results.flat();
}

async function versProtocol(ctx: any, table: string, where: string): Promise<any[]> {
    if (!versedTables(ctx.app.db)[table]) return [];
    const sql =
        `SELECT t._vers_log, l.time, l.sess_id, usr.id as usr_id, usr.email ` +
        `FROM \`_vers_${table}\` t ` +
        `LEFT JOIN log l ON t._vers_log = l.id ` +
        `LEFT JOIN sess  ON l.sess_id = sess.id ` +
        `LEFT JOIN usr   ON sess.usr_id = usr.id ` +
        `WHERE t._vers_space = ? AND t._vers_log > 0 AND ${where} ` +
        `ORDER BY t._vers_log`;
    const rows = await ctx.app.db.all(sql, [getCmsVers(ctx).space]);
    return rows.map((r: any) => ({
        vers: r._vers_log,
        time: Number(r.time ?? 0),
        usr:  r.usr_id ? r.email : "guest",
    }));
}
