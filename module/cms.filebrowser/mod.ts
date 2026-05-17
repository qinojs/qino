// deno-lint-ignore-file no-explicit-any
// Port of cms.filebrowser/qg.php

import { getCtx } from "../core/lib/RequestContext.ts";
import { s } from "../core/lib/StandardSchema.ts";
import { Access, type AptTree } from "../core/lib/apt/mod.ts";
import type { App } from "../core/server.ts";

export const name = "cms.filebrowser";
export const needs = ["cms"];

export function init(app: App) {
    app.aptTree["cms.filebrowser"] = api;

    app.on("cms-ready", ({ ctx }: any) => {
        if (ctx.get.qgCmsNoFrontend) return;
        if (!ctx.state.editmode) return;
        ctx.html.addJSM(ctx.sysURL + "cms.filebrowser/pub/init.mjs");
    });

    app.on("dbFile::access2", async (e: any) => {
        if (e.access) return;
        const ctx = getCtx() as any;
        const userId = ctx.userId;
        if (!userId) return;
        const row = await app.db.row(
            "SELECT usr_id FROM usr_file WHERE usr_id = ? AND file_id = ?",
            [userId, String(e.File)],
        );
        if (row) e.access = true;
    });
}

async function search(s_: string, ctx: any): Promise<any[]> {
    const db = ctx.app.db;
    const cms = ctx.app.cms;

    let sql =
        " SELECT pf.page_id AS pid, f.id, f.mime, f.name, f.md5, f.access" +
        " FROM file f" +
        " LEFT JOIN page_file pf ON pf.file_id = f.id" +
        " WHERE 1";

    const params: any[] = [];

    if (s_) {
        sql +=
            " AND (" +
            "   f.id = ?" +
            "   OR f.name LIKE ?" +
            "   OR f.text LIKE ?" +
            " )";
        params.push(s_, "%" + s_ + "%", s_ + "%");
    }

    sql += " ORDER BY";

    if (s_) {
        sql +=
            " f.id = ? DESC," +
            " f.name = ? DESC," +
            " f.name LIKE ? DESC," +
            " f.name LIKE ? DESC," +
            " f.text = ? DESC," +
            " f.text LIKE ? DESC," +
            " f.name ASC,";
        params.push(s_, s_, s_ + "%", "% " + s_ + "%", s_, s_ + "%");
    }

    sql += " f.id DESC";

    const rows = await db.all(sql, params);

    const res: Record<string, any> = {};

    for (const vs of rows) {
        const Page = vs.pid ? await cms.node(Number(vs.pid)) : null;
        const dbFile = await ctx.app.dbFiles.file(Number(vs.id), vs);

        if (!await dbFile.exists()) continue;
        if (!await dbFile.access()) continue;

        const md5 = vs.md5 as string;
        if (!res[md5]) {
            res[md5] = {
                id: vs.id,
                mime: vs.mime,
                url: await dbFile.url({}),
                name: dbFile.name,
                pages: {} as Record<string, string>,
            };
        }
        if (Page) {
            const title = await Page.title();
            res[md5].pages[String(Page.id)] = await title.string() ?? String(Page.id);
        }
    }

    const items: any[] = [];
    let i = 0;
    for (const item of Object.values(res)) {
        if (i++ >= 100) break;
        items.push(item);
    }
    return items;
}

export const api: AptTree = {
    search: {
        get: {
            description: "Dateien im CMS-Filebrowser suchen.",
            access: Access.USER,
            query: s.object({ s: s.optional(s.string()) }),
            execute: ({ s: needle }: any, ctx: any) => search(needle ?? "", ctx),
        },
    },
};
