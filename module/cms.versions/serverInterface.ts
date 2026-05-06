/**
 * cms.versions/serverInterface.ts
 * Port of cms.versions/serverInterface.php
 */

// deno-lint-ignore-file no-explicit-any

import { serverInterface } from "../core/lib/serverInterface.ts";
import { versedTables, view, getCmsVers } from "./lib/Vers.ts";
import { publishCont as doPublishCont } from "./lib/CmsVers.ts";

export async function publishCont(ctx: any, pid: any, options: any = {}): Promise<any> {
        const Page = await ctx.app.cms.node(parseInt(String(pid)));
        await Page.init();
        if ((await Page.access()) < 2) return false;
        options = {
            fromSpace: getCmsVers(ctx).cmsVersSpace,
            fromLog:   0,
            toSpace:   getCmsVers(ctx).cmsVersSpace,
            subPages:  false,
            ...options,
        };
        await doPublishCont(
            ctx.app.db,
            parseInt(String(pid)),
            options.fromSpace,
            options.fromLog,
            options.toSpace,
            options.subPages,
        );
}

export async function getForPage(ctx: any, pid: any): Promise<any[]> {
        const data = await versProtocolForPageAndConts(ctx, parseInt(String(pid)));
        // Deduplicate by log id
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

        let post: any = {};
        try { post = JSON.parse(String(row.post || "{}")); } catch { /* ignore */ }
        const askJson = post.askJSON ?? "{}";
        let data: any = {};
        try { data = JSON.parse(askJson); } catch { /* ignore */ }

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
                        await P.init();
                        messages.push((await contOrPage(P)) + ` Text "${vs.name}" geändert`);
                    } else {
                        const vs2 = await ctx.app.db.row(
                            `SELECT id FROM page WHERE title_id = ?`, [parseInt(args[0])]
                        );
                        if (vs2) {
                            const P = await ctx.app.cms.node(vs2.id);
                            await P.init();
                            messages.push((await contOrPage(P)) + " Titel geändert");
                        }
                    }
                } else if (fn === "page::insertBefore") {
                    const P = await ctx.app.cms.node(args[1]);
                    await P.init();
                    messages.push((await contOrPage(P)) + " " + translateFn[fn]);
                } else if (fn === "SettingsEditor::set" || fn === "Setting") {
                    messages.push("Einstellung geändert");
                } else if (translateFn[fn]) {
                    const P = await ctx.app.cms.node(args[0]);
                    await P.init();
                    messages.push((await contOrPage(P)) + " " + translateFn[fn]);
                } else {
                    messages.push(`<span style="color:red">${fn}</span>`);
                }
            }
        }

        return {
            messages,
            usr:     row.email !== null ? row.email : "guest",
            ip:      row.ip ?? "",
            browser: row.user_agent ?? "",
            time:    parseInt(String(row.time ?? 0)),
        };
}

serverInterface.cms_vers = {

    publishCont(pid: any, options: any = {}): Promise<any> {
        return this.ctx.app.apt["cms.versions"]["publish-cont"].post({ pid: parseInt(String(pid)), options });
    },

    getForPage(pid: any): Promise<any[]> {
        return this.ctx.app.apt["cms.versions"].page(pid).get();
    },

    logDetails(id: any): Promise<any> {
        return this.ctx.app.apt["cms.versions"].log(id).get();
    },
};

// ─── Protocol helpers ────────────────────────────────────────────────────────

async function versProtocolForPageAndConts(ctx: any, pid: number): Promise<any[]> {
    const data = await versProtocolForPage(ctx, pid);
    const P = await ctx.app.cms.node(pid);
    await P.init();
    const conts = await P.Conts?.() ?? [];
    for (const C of conts) {
        const sub = await versProtocolForPageAndConts(ctx, C.id);
        data.push(...sub);
    }
    return data;
}

async function versProtocolForPage(ctx: any, pid: number): Promise<any[]> {
    const space = getCmsVers(ctx).cmsVersSpace;
    const spaceView = (t: string) => view(ctx.app.db, t, space, 0);

    const protocol = [
        ...await versProtocol(ctx, "page",      `t.id = ${pid}`),
        ...await versProtocol(ctx, "page_text",  `t.page_id = ${pid}`),
        ...await versProtocol(ctx, "text",
            `t.id = (SELECT title_id FROM \`${await spaceView("page")}\` WHERE id = ${pid})`),
        ...await versProtocol(ctx, "text",
            `t.id IN(SELECT text_id FROM \`${await spaceView("page_text")}\` WHERE page_id = ${pid})`),
        ...await versProtocol(ctx, "file",
            `t.id IN(SELECT file_id FROM \`${await spaceView("page_file")}\` WHERE page_id = ${pid})`),
    ];
    return protocol;
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
