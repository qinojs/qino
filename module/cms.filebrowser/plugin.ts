// deno-lint-ignore-file no-explicit-any

import { getCtx, requestStorage, sql, type Ctx, s, Access, type AptTree, type App } from "../core/mod.ts";
import { cms, cmsCtx } from "../cms/mod.ts";

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
      execute: ({ s: needle }: any, ctx: Ctx) => search(needle ?? "", ctx),
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend) return;
    if (!cmsCtx(ctx).editmode) return;
    ctx.res.html.scripts.add(ctx.req.modulePath + "cms.filebrowser/pub/init.mjs");
  }, { signal });

  app.on("dbFile:access-fallback", async (e) => {
    if (e.access) return;
    const ctx = getCtx();
    const userId = ctx.userId;
    if (!userId) return;
    const row = await app.db.row`SELECT usr_id FROM usr_file WHERE usr_id = ${userId} AND file_id = ${String(e.file)}`;
    if (row) e.access = true;
  }, { signal });

  // Grant the uploading user access to their new file. A file insert always yields a
  // fresh id, so the (usr_id, file_id) pair is new — plain insert, no ensure needed.
  app.db.on("table:insert-after", (e) => {
    if (e.table.name !== "file") return;
    const userId = requestStorage.getStore()?.userId; // no request (import/install) → no grant
    if (!userId) return;
    const added = new Date().toISOString().slice(0, 19).replace("T", " ");
    app.db.table("usr_file").insert({ usr_id: userId, file_id: e.id, added }).catch(() => {}); // best-effort, must not break the upload
  }, { signal });
}

async function search(s_: string, ctx: Ctx): Promise<any[]> {
  const db = ctx.app.db;

  const cond = s_
    ? sql` AND ( f.id = ${s_} OR f.name LIKE ${"%" + s_ + "%"} OR f.text LIKE ${s_ + "%"} )`
    : sql.raw("");
  const order = s_
    ? sql` f.id = ${s_} DESC, f.name = ${s_} DESC, f.name LIKE ${s_ + "%"} DESC, f.name LIKE ${"% " + s_ + "%"} DESC, f.text = ${s_} DESC, f.text LIKE ${s_ + "%"} DESC, f.name ASC,`
    : sql.raw("");

  const rows = await db.query`
    SELECT f.*, pf.page_id AS pid
    FROM file f
    LEFT JOIN page_file pf ON pf.file_id = f.id
    WHERE true${cond}
    ORDER BY${order} f.id DESC`;

  const res: Record<string, any> = {};

  for (const vs of rows) {
    const Page = vs.pid ? await cms(ctx.app).node(Number(vs.pid)) : null;
    const dbFile = await ctx.app.dbFiles.file(Number(vs.id), vs);

    if (!await dbFile.exists()) continue;
    if (!await dbFile.access()) continue;

    const md5 = vs.md5;
    res[md5] ||= {
      id: vs.id,
      mime: vs.mime,
      url: await dbFile.url({width: 180, height: 130, max: true}),
      name: dbFile.name,
      pages: {} as Record<string, string>,
    };
    if (Page) {
      const title = await Page.title();
      res[md5].pages[String(Page.id)] = await title.string() ?? String(Page.id);
    }
  }

  return Object.values(res).slice(0, 100);
}
