// deno-lint-ignore-file no-explicit-any

import { hee, sql, type App, type RequestContext } from "../../core/mod.ts";
import { getCmsVers, tableEntriesCopyTo } from "../../cms.versions/mod.ts";

const ALLOWED_META = new Set(["name", "vpos", "hpos"]);

/** True if the file is referenced by a page the current user may edit. */
export async function isWritable(ctx: RequestContext, fileId: number): Promise<boolean> {
    return !!await writablePage(ctx, fileId);
}

/** First page referencing the file that the user may edit (access > 1), or null. */
export async function writablePage(ctx: RequestContext, fileId: number): Promise<any> {
    const rows = await ctx.app.db.all`SELECT page_id FROM page_file WHERE file_id = ${fileId}`;
    for (const row of rows) {
        const Page = await ctx.app.cms.node(Number(row.page_id));
        if ((await Page.access()) > 1) return Page;
    }
    return null;
}

export async function getMeta(ctx: RequestContext, fileId: number): Promise<{ name: string; vpos: any; hpos: any }> {
    const File = await ctx.app.dbFiles.file(fileId);
    return {
        name: await File.get("name") ?? "",
        vpos: await File.get("vpos") ?? null,
        hpos: await File.get("hpos") ?? null,
    };
}

export async function setMeta(ctx: RequestContext, fileId: number, data: Record<string, any>): Promise<void> {
    const vs: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) if (ALLOWED_META.has(k)) vs[k] = v;
    if (!Object.keys(vs).length) return;
    await (await ctx.app.dbFiles.file(fileId)).setVs(vs);
}

/** Restore a versioned file state (live ← given log) in the current cms space. */
export async function restore(ctx: RequestContext, fileId: number, log: number): Promise<void> {
    const space = getCmsVers(ctx).space;
    await tableEntriesCopyTo(ctx.app.db, "file", { id: fileId }, space, log, space);
    ctx.app.dbFiles.clearCache(fileId);
}

/** HTML table of the file's version history with restore-on-click thumbnails. */
export async function getHistory(ctx: RequestContext, fileId: number): Promise<string> {
    const app = ctx.app;
    const space = getCmsVers(ctx).space;
    const rows = await app.db.all`
        SELECT file.*, log.id AS log_id, log.time AS log_time
        FROM _vers_file file
          LEFT JOIN log ON file._vers_log = log.id
        WHERE file._vers_log AND file.id = ${fileId} AND file._vers_space = ${space}
        ORDER BY file._vers_log DESC
        LIMIT 40`;

    let str = '<table style="width:100%">';
    for (const row of rows) {
        const thumb = await versionThumb(app, fileId, row);
        if (!thumb) continue;
        str += "<tr>";
        str += `<td style="padding:3px 4px 3px 0; width:60px"><img log="${hee(String(row.log_id))}" style="display:block; margin:auto; border:1px solid black; cursor:pointer" src="${thumb}">`;
        str += `<td style="padding:3px 0 3px 0;">${hee(niceDate(Number(row.log_time)))}`;
        const usr = await logUser(app, Number(row.log_id));
        if (usr) str += `<br>${hee(usr)}`;
    }
    str += "</table>";
    app.dbFiles.clearCache(fileId);
    return str;
}

// 60×40 thumbnail (same size as the media preview) of a specific version row, as data URL.
async function versionThumb(app: App, fileId: number, row: any): Promise<string | undefined> {
    if (!row.md5) return;
    try {
        const File = await app.dbFiles.file(fileId, row); // setLocalVs → path points at this version's md5
        if (!File.path) return;
        const { path, mime } = await File.transform({ w: 60, h: 40, max: true, q: 5 });
        const buf = await Deno.readFile(path);
        return `data:${mime};base64,${btoa(String.fromCharCode(...buf))}`;
    } catch {
        return;
    }
}

async function logUser(app: App, logId: number): Promise<string> {
    const row = await app.db.row`
        SELECT usr.firstname, usr.lastname
        FROM log
          LEFT JOIN sess ON log.sess_id = sess.id
          LEFT JOIN usr  ON sess.usr_id = usr.id
        WHERE log.id = ${logId}`;
    if (!row) return "";
    return [row.firstname, row.lastname].filter(Boolean).join(" ");
}

function niceDate(ts: number): string {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString();
}
