import { DbFile, html, isEmptyObject } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { getCmsVers, tableEntriesCopyTo } from "@qino/qino/cms.versions";

import type { App, Ctx } from "@qino/qino";

// deno-lint-ignore-file no-explicit-any

const ALLOWED_META = new Set(["name", "vpos", "hpos"]);

/** True if the file is referenced by a page the current user may edit. */
export async function isWritable(ctx: Ctx, fileId: number): Promise<boolean> {
    return !!await writablePage(ctx, fileId);
}

/** First page referencing the file that the user may edit (access > 1), or null. */
export async function writablePage(ctx: Ctx, fileId: number): Promise<any> {
    for (const row of await ctx.app.db.query`SELECT page_id FROM page_file WHERE file_id = ${fileId}`) {
        const p = await cms(ctx.app).node(Number(row.page_id));
        if (await p.access() > 1) return p;
    }
    return null;
}

export async function getMeta(ctx: Ctx, fileId: number): Promise<{ name: string; vpos: any; hpos: any }> {
    const dbFile = await ctx.app.dbFiles.file(fileId);
    return {
        name: await dbFile.get("name") ?? "",
        vpos: await dbFile.get("vpos") ?? null,
        hpos: await dbFile.get("hpos") ?? null,
    };
}

export async function setMeta(ctx: Ctx, fileId: number, data: Record<string, any>): Promise<void> {
    const vs: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) { // hpos/vpos are percentages, clamp to 0..100
        if (!ALLOWED_META.has(k) || v === undefined) continue;
        vs[k] = k === "name" ? String(v).trim() : Math.max(0, Math.min(100, Number(v)));
    }
    if (isEmptyObject(vs)) return;
    await (await ctx.app.dbFiles.file(fileId)).setVs(vs);
}

/** Restore a versioned file state (live ← given log) in the current cms space. */
export async function restore(ctx: Ctx, fileId: number, log: number): Promise<void> {
    const space = getCmsVers(ctx).space;
    await tableEntriesCopyTo(ctx.app.db, "file", { id: fileId }, space, log, space);
    ctx.app.dbFiles.clearCache(fileId);
}

/** HTML table of the file's version history with restore-on-click thumbnails. */
export async function getHistory(ctx: Ctx, fileId: number): Promise<string> {
    const app = ctx.app;
    const space = getCmsVers(ctx).space;
    const rows = await app.db.query`
        SELECT file.*, log.time AS log_time, usr.given_name AS usr_given_name, usr.family_name AS usr_family_name
        FROM _vers_file file
          LEFT JOIN log  ON file._vers_log = log.id
          LEFT JOIN sess ON log.sess_id = sess.id
          LEFT JOIN usr  ON sess.usr_id = usr.id
        WHERE file._vers_log AND file.id = ${fileId} AND file._vers_space = ${space}
        ORDER BY file._vers_log DESC
        LIMIT 40`;

    const trs = [];
    for (const row of rows) {
        const thumb = await versionThumb(app, fileId, row);
        if (!thumb) continue;
        const log = String(row._vers_log); // restore token = this capture's version log (log-table join is display-only)
        const usr = [row.usr_given_name, row.usr_family_name].filter(Boolean).join(" ");
        trs.push(html`<tr>
        <td style="padding:.1875rem .25rem .1875rem 0; width:3.75rem"><img log="${log}" style="display:block; margin:auto; border:1px solid black; cursor:pointer" src="${thumb}">
        <td style="padding:.1875rem 0 .1875rem 0;">${niceDate(Number(row.log_time))}${usr ? html`<br>${usr}` : ""}`);
    }
    return html`<table style="width:100%">${trs}</table>`.toString(); // api endpoint: plain string output
}

// 60×40 thumbnail (same size as the media preview) of a specific version row, as data URL.
async function versionThumb(app: App, fileId: number, row: any): Promise<string | undefined> {
    if (!row.md5) return;
    try {
        const dbFile = new DbFile(app.dbFiles, fileId, row); // detached: path points at this version's md5, live cache untouched
        if (!dbFile.path) return;
        const { path, mime } = await dbFile.transform({ w: 60, h: 40, max: true, q: 50, fmt: "avif" });
        const buf = await Deno.readFile(path);
        return `data:${mime};base64,${btoa(String.fromCharCode(...buf))}`;
    } catch {/**/}
}

function niceDate(ts: number): string {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString();
}
