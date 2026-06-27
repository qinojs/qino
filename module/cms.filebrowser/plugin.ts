// deno-lint-ignore-file no-explicit-any

import { getCtx, sql, type RequestContext, s, Access, type AptTree, type App } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "cms.filebrowser";
export { healthChecks } from "./healthChecks.ts";
export const needs = ["cms"];

// Per-user file access grants (legacy `usr_file` table).
export const dbSchema = {
    properties: {
        usr_file: {
            additionalProperties: {
                properties: {
                    usr_id: { type: "integer", "x-index": "primary", "x-qg-parent": "usr", "x-qg-on-parent-delete": "cascade" },
                    file_id: { type: "integer", "x-index": "primary", "x-qg-parent": "file", "x-qg-on-parent-delete": "cascade" },
                    added: { type: "string", format: "date-time", "x-index": true },
                },
                required: ["usr_id", "file_id", "added"],
            },
        },
    },
};

export const api: AptTree = {
    search: {
        get: {
            description: "Search files in the CMS file browser.",
            access: Access.USER,
            query: s.object({ s: s.optional(s.string()) }),
            execute: ({ s: needle }: any, ctx: RequestContext) => search(needle ?? "", ctx),
        },
    },
};

export function init(app: App) {
    app.on("cms-ready", e => {
        const ctx = e.ctx as RequestContext;
        if (ctx.get.qgCmsNoFrontend) return;
        if (!ctx.cms.editmode) return;
        ctx.html.scripts.add(ctx.sysURL + "cms.filebrowser/pub/init.mjs");
    });

    app.on("dbFile::access2", async (e: any) => {
        if (e.access) return;
        const ctx = getCtx();
        const userId = ctx.userId;
        if (!userId) return;
        const row = await app.db.row`SELECT usr_id FROM usr_file WHERE usr_id = ${userId} AND file_id = ${String(e.File)}`;
        if (row) e.access = true;
    });
}

async function search(s_: string, ctx: RequestContext): Promise<any[]> {
    const db = ctx.app.db;
    const cms = ctx.app.cms;

    const cond = s_
        ? sql` AND ( f.id = ${s_} OR f.name LIKE ${"%" + s_ + "%"} OR f.text LIKE ${s_ + "%"} )`
        : sql.raw("");
    const order = s_
        ? sql` f.id = ${s_} DESC, f.name = ${s_} DESC, f.name LIKE ${s_ + "%"} DESC, f.name LIKE ${"% " + s_ + "%"} DESC, f.text = ${s_} DESC, f.text LIKE ${s_ + "%"} DESC, f.name ASC,`
        : sql.raw("");

    const rows = await db.all`
        SELECT f.*, pf.page_id AS pid
        FROM file f
        LEFT JOIN page_file pf ON pf.file_id = f.id
        WHERE true${cond}
        ORDER BY${order} f.id DESC`;

    const res: Record<string, any> = {};

    for (const vs of rows) {
        const Page = vs.pid ? await cms.node(Number(vs.pid)) : null;
        const dbFile = await ctx.app.dbFiles.file(Number(vs.id), vs);

        if (!await dbFile.exists()) continue;
        if (!await dbFile.access()) continue;

        const md5 = vs.md5;
        res[md5] ||= {
            id: vs.id,
            mime: vs.mime,
            url: await dbFile.url({}),
            name: dbFile.name,
            pages: {} as Record<string, string>,
        };
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
