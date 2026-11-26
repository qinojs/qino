// deno-lint-ignore-file no-explicit-any
import { getCtx, requestStorage, sql, sqlSearch, s, Access } from "@qino/qino";
import { cms, cmsCtx, thumbUrl } from "@qino/qino/cms";

import type { Ctx, ApiTree, App } from "@qino/qino";

export { healthChecks } from "./healthChecks.ts";

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

export const api: ApiTree = {
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
  cms(app).on("page:render-after", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || !cmsCtx(ctx).editmode) return;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.filebrowser/pub/init.mjs");
  }, { signal });

  app.on("dbFile:access-fallback", async (e) => {
    if (e.access) return;
    const ctx = getCtx();
    const userId = ctx.userId;
    if (!userId) return;
    const row = await app.db.row`SELECT usr_id FROM usr_file WHERE usr_id = ${userId} AND file_id = ${e.file.id}`;
    if (row) e.access = true;
  }, { signal });

  // Give the uploader access to the new file (new id, so a plain insert).
  app.db.on("table:insert-after", (e) => {
    if (e.table.name !== "file") return;
    const userId = requestStorage.getStore()?.userId; // no request (import/install) → no grant
    if (!userId) return;
    const added = new Date().toISOString().slice(0, 19).replace("T", " ");
    app.db.table("usr_file").insert({ usr_id: userId, file_id: e.id, added }).catch(() => {}); // best-effort, must not break the upload
  }, { signal });
}

async function search(s_: string, ctx: Ctx) {
  const db = ctx.app.db;

  // file contents live in the fulltext-indexed `text` column; only MySQL can use that index
  const inText = db.dialect === "mysql"
    ? sql`MATCH(f.text) AGAINST (${s_ + "*"} IN BOOLEAN MODE)`
    : sql`f.text LIKE ${"%" + s_ + "%"}`;
  const sh = sqlSearch(s_, ["f.name"], { exact: ["f.id"] });
  const cond = s_ ? sql` AND ( ${sh.where} OR ${inText} )` : sql``;
  const order = s_ ? sql` ${sh.order}, ${inText} DESC, f.name ASC,` : sql``;

  const rows = await db.query`
    SELECT f.*, pf.page_id AS pid
    FROM file f
    LEFT JOIN page_file pf ON pf.file_id = f.id
    WHERE true${cond}
    ORDER BY${order} f.id DESC
    LIMIT 500`; // one row per page from the join; only a safety cap

  const res: Record<string, any> = {}, cm = cms(ctx.app);

  for (const vs of rows) {
    const dbFile = await ctx.app.dbFiles.file(Number(vs.id), vs);
    if (!await dbFile.exists() || !await dbFile.access()) continue;

    const md5 = vs.md5;
    res[md5] ||= {
      id: vs.id,
      mime: vs.mime,
      thumb: await thumbUrl(dbFile, { size: "big" }),
      name: dbFile.name,
      pages: {} as Record<string, string>,
    };
    if (vs.pid) {
      const page = await cm.node(Number(vs.pid));
      res[md5].pages[String(page.id)] = await (await page.title()).string();
    }
  }

  return Object.values(res).slice(0, 100);
}
