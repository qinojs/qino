import { getCtx, html, sql, FileTransformer, deleteUnlinkedDbFiles } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import manifest from "./manifest.json" with { type: "json" };

import type { HtmlString, App, DbField, DbFile, Ctx, Sql } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }) {
  await backend.install(app, name, { en: "DB Files", de: "DB Dateien" });
}

const IMG = new Set(["jpg","jpeg","gif","png","svg","webp"]);
const VID = new Set(["mp4","webm","mov","avi","mkv"]);
const AUD = new Set(["mp3","flac","ogg","aac","wav","m4a"]);
const TXT = new Set(["txt","csv","json","xml","html","htm","css","js","ts","md","yaml","yml","svg"]);

async function mediaPreview(f: DbFile, exists: boolean): Promise<HtmlString> {
  if (!exists) return html`<u2-ico inline icon=cancel aria-label="not found" style="color:red">✗</u2-ico>`;
  return html`<img src="${await f.url({w:70,h:40,max:true,page:1,frame:1})}" alt="">`;
}

async function mediaView(f: DbFile): Promise<HtmlString | string> {
  const ext = f.extension;
  const url = await f.url();
  let inner: HtmlString | string = "";
  if (IMG.has(ext) && await FileTransformer.capabilities.magick)
    inner = html`<img src="${url}" class=-preview-img alt="">`;
  else if (VID.has(ext))
    inner = html`<video src="${url}" controls style="max-width:100%"></video>`;
  else if (AUD.has(ext))
    inner = html`<audio src="${url}" controls></audio>`;
  else if (ext === "pdf")
    inner = html`<iframe src="${url}" style="width:100%;height:37.5rem;border:0"></iframe>`;
  return inner ? html`<div class=u2-card style="flex:0 1 auto"><div>${inner}</div></div>` : "";
}

async function textView(f: DbFile): Promise<HtmlString | string> {
  if (!TXT.has(f.extension)) return "";
  return html`<div class=u2-card style="flex:0 1 auto"><div><u2-code trim><textarea>${await
    Deno.readTextFile(f.path)}</textarea></u2-code></div></div>`;
}

const fileChildren = (node: Node) => node.app.db.table("file").children.filter(
  (f: DbField) => f.table.name !== "log" && f.table.name !== "mail_file"
);

// "not exists" sorts by the correlated relation-count subqueries → scans the whole table,
// so it is selectable but never the default; the others are index-backed (log_id / size).
const ORDERS = ["newest", "oldest", "changed", "biggest", "not exists"];

// list (filterable part): total + table rows, reloaded on search/order change
async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, any> }): Promise<HtmlString> {
  const app = node.app;
  const { db, dbFiles: fm } = app;

  const children = fileChildren(node);
  const search = String(vars.search ?? "");
  const order  = String(vars.order  ?? "newest");

  const relSubs = sql.join(children.map((dbFile: DbField, i: number) =>
    sql`,(SELECT COUNT(*) FROM ${sql.id(dbFile.table.name)} WHERE ${sql.id(dbFile.name)}=f.id) AS ${sql.id("r" + i)}`), "");

  const orderSql: Record<string, Sql> = {
    newest:sql`f.log_id DESC`,
    oldest:sql`f.log_id ASC`,
    changed:sql`f.log_id_ch DESC`,
    biggest:sql`f.size DESC`
  };
  const orderBy = orderSql[order] ?? sql.join([sql`f.size = ${0} DESC`, ...children.map((_: DbField, i: number) => sql.id("r" + i))], ",");

  // one indexed path per input shape (never an OR across joined tables, which would full-scan):
  // number → id (PK), 32-hex → md5, contains @ → creator/editor email, else → name fulltext
  let cond = sql``;
  if (search) {
    const s = search.trim();
    const emailSub = (col: string) => sql`f.${sql.id(col)} IN (SELECT l.id FROM log l JOIN sess se ON se.id=l.sess_id JOIN usr u ON u.id=se.usr_id WHERE u.username=${s})`;
    if (/^\d+$/.test(s)) cond = sql` AND f.id = ${Number(s)}`;
    else if (/^[0-9a-f]{32}$/i.test(s)) cond = sql` AND f.md5 = ${s}`;
    else if (s.includes("@")) cond = sql` AND (${emailSub("log_id")} OR ${emailSub("log_id_ch")})`;
    else if (db.dialect === "mysql") cond = sql` AND MATCH(f.name) AGAINST (${s + "*"} IN BOOLEAN MODE)`;
    else cond = sql` AND f.name LIKE ${"%" + s + "%"}`;
  }

  const rows = await db.query`
    SELECT f.*,log_i.time AS init_time,log_e.time AS edit_time,ui.username AS usr_init_username,ue.username AS usr_edit_username${relSubs}
    FROM file f
      LEFT JOIN log log_i ON log_i.id=f.log_id LEFT JOIN sess sess_i ON sess_i.id=log_i.sess_id LEFT JOIN usr ui ON ui.id=sess_i.usr_id
      LEFT JOIN log log_e ON log_e.id=f.log_id_ch LEFT JOIN sess sess_e ON sess_e.id=log_e.sess_id LEFT JOIN usr ue ON ue.id=sess_e.usr_id
    WHERE ${true}${cond}
    ORDER BY ${orderBy} LIMIT 1000`;

  const relHeaders = children.map((dbFile) => 
    html`<th style="writing-mode:sideways-lr" title="${dbFile.table.name+"."+dbFile.name}">${dbFile.table.name}`);

  const trs = [];
  const u = ctx.req.url.toURL();
  for (const row of rows) {
    const f = await fm.file(row.id, row);
    const exists = await f.exists();
    u.searchParams.set("id", String(row.id));
    const cells = children.map((_: DbField, i: number) => row[`r${i}`] ? html`<td title="${row[`r${i}`]}x">◼` : html.raw("<td>◻"));
    trs.push(html.async`<tr u2-href>
  <td class=-thumb>${mediaPreview(f, !!exists)}
  <td>${row.id}
  <td><a href="${u.search}">${row.name}${!exists ? html.async` <small style="color:red">${app.t`missing`}</small>` : ""}</a>
  <td><u2-bytes>${row.size}</u2-bytes>
  ${cells}
  <td>${u2.el.time(row.init_time)}<br><small>${row.usr_init_username}</small>
  <td>${u2.el.time(row.edit_time)}<br><small>${row.usr_edit_username}</small>
  <td>${await f.used()?"◼":""}
  <td>${row.access?"◼":""}
  <td>
    <button data-delete="${row.id}" class=u2-unstyle u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`);
  }

  return html.async`
<caption>${app.t`Total`}: ${rows.length}</caption>
<thead><tr style="vertical-align:bottom">
  <th>${app.t`File`}
  <th>${app.t`ID`}
  <th>${app.t`Name`}
  <th>${app.t`Size`}
  ${relHeaders}
  <th>${app.t`Created`}
  <th>${app.t`Changed`}
  <th style="writing-mode:sideways-lr">${app.t`Used`}
  <th style="writing-mode:sideways-lr">${app.t`Public`}
  <th>
<tbody>${trs}`;
}

async function runAction(node: Node, doName: string): Promise<HtmlString | string> {
  if (doName === "delete_unlinked") {
    const r = await deleteUnlinkedFs(node);
    return html.async`${r.deleted} ${node.app.t`files deleted`} <small>(<u2-bytes>${r.size}</u2-bytes>)</small>`;
  }
  if (doName === "delete_unlinked_db") {
    const r = await deleteUnlinkedDbFiles(node.app);
    return html.async`${r.deleted} ${node.app.t`DB entries deleted`}`;
  }
  return "";
}

async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const fm = node.app.dbFiles;
  if (vars.delete) { await (await fm.file(Number(vars.delete))).remove(); return { done: true }; }
  if (vars.id != null) {
    const f = await fm.file(Number(vars.id));
    if (vars.set_name != null)   await f.setVs({ name: String(vars.set_name) });
    if (vars.set_public != null) await f.setVs({ access: vars.set_public ? 1 : 0 });
    if (vars.set_mime != null)   await f.setVs({ mime: String(vars.set_mime) });
    return { done: true };
  }
  return false;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const ctx = getCtx();
  const app = node.app;
  const get = ctx.req.query;

  if (get.id) return renderDetail(node, Number(get.id));

  const message = vars.do ? await runAction(node, String(vars.do)) : "";
  const orderOpts = ORDERS.map(o => html`<option>${o}`);

  return html.async`
<div class=u2-flex>
  <div class="u2-card -sidebar">
    <div class=-head>${app.t`Filter`}</div>
    <div>
      <form data-filter>
        <label>${app.t`Search`}<br><input name=search></label><br><br>
        <label>${app.t`Order`}<br><select name=order>${orderOpts}</select></label>
      </form>
    </div>
    <div class=-head>${app.t`Actions`}</div>
    <div>
      ${message ? html`<p>${message}</p>` : ""}
      <button data-reload='{"do":"delete_unlinked"}'>${app.t`Delete files without DB entry`}</button><br>
      <small>${app.t`Files in version history will not be deleted.`}</small><br><br>
      <button data-reload='{"do":"delete_unlinked_db"}'>${app.t`Delete DB entries without link`}</button><br>
      <small>${app.t`Warning: only files older than 7 days.`}</small>
    </div>
  </div>
  <div class="u2-card -main" style="max-height:90vh">
    <table class="u2-table -Sticky" cms-part=list>${list(node, { ctx, vars: {} })}</table>
  </div>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<HtmlString> {
  const ctx = getCtx();
  u2.elements(ctx, "code"); // the text view highlights with a library of its own
  const app = node.app;

  const { db, dbFiles: fm } = app;

  const row = await db.row`SELECT * FROM file WHERE id = ${id}`;
  if (!row) return html.async`<div>${app.t`File not found`}</div>`;

  const f = await fm.file(id, row);
  const exists = await f.exists();

  const linkParts = await Promise.all(fileChildren(node).map(async (field: DbField) => {
    const rows = await db.query`SELECT * FROM ${sql.id(field.table.name)} WHERE ${sql.id(field.name)}=${id}`;
    return rows.map((lr) => html`<div>${field.table.name+"."+field.name}: ${JSON.stringify(lr)}</div>`);
  }));
  const linkInner = linkParts;
  const linksHtml = String(linkInner) ? linkInner : html`<div class=-body>none</div>`;

  const dupes = await db.query`SELECT id,name FROM file WHERE id!=${id} AND md5=${row.md5}`;
  const dupeU = ctx.req.url.toURL();

  const preview = exists ? await mediaView(f) : "";
  const text = exists ? await textView(f) : "";

  return html.async`
<div class=u2-flex>

  <div class=u2-flex style="flex-direction:column; ">
    <div class=u2-card style="flex:0 0 auto" data-file-id="${row.id}">
      <div class=-head>${row.name}</div>
      ${!exists ? html.async`<div class=-body style="color:red">${app.t`file missing on disk!`}</div>` : ""}
      <table class="u2-table -Fields">
        <tr><th>${app.t`ID`}<td>${row.id}
        <tr>
          <th>${app.t`Name`}
          <td><input value="${row.name}" data-set=set_name>
        <tr>
          <th>${app.t`Public`}
          <td><input type=checkbox ${row.access?"checked":""} data-set=set_public>
        <tr>
          <th>${app.t`Mime`}
          <td><input value="${row.mime}" data-set=set_mime>
        <tr><th>${app.t`Size`}<td><u2-bytes>${row.size}</u2-bytes> <small>(${Number(row.size).toLocaleString()} bytes)</small>
        <tr><th>${app.t`MD5`}<td><code>${row.md5}</code>
        <tr><th>${app.t`URL`}<td><a href="${f.url()}" target=_blank data-url>${app.t`open`}</a> <a href="${f.url({dl:true})}" download>${app.t`download`}</a> <button data-copy-url>${app.t`copy url`}</button>
      </table>
    </div>

    <div class=u2-card style="flex:0 0 auto">
      <div class=-head>${app.t`Duplicates`}</div>
      ${dupes.length
          ? html.async`<table class=u2-table>
            <tr><th>${app.t`ID`}<th>${app.t`Name`}
            ${dupes.map((d) => {
              dupeU.searchParams.set("id", String(d.id));
              return html`<tr><td><a href="${dupeU.search}">${d.id}</a><td>${d.name}`;
            })}
          </table>`
          : html.async`<div class=-body>${app.t`none`}</div>`}
    </div>

    <div class=u2-card style="flex:0 0 auto">
      <div class=-head>${app.t`Links`}</div>
      ${linksHtml}
    </div>
  </div>

  ${preview}

  ${text}

</div>`;
}

async function deleteUnlinkedFs(node: Node) {
  const { db, dbFiles: fm } = node.app;
  const dbMd5s = new Set((await db.query`SELECT md5 FROM file WHERE md5 IS NOT NULL`).map((r) => r.md5));
  let deleted = 0, size = 0;
  for await (const e of Deno.readDir(fm.directory)) {
    if (e.name.length < 32 || e.name[0] === "." || dbMd5s.has(e.name)) continue;
    const path = fm.directory + e.name;
    const fileSize = (await Deno.stat(path).catch(()=>null))?.size ?? 0;
    if (!await Deno.remove(path).then(()=>true, ()=>false)) continue;
    deleted++;
    size += fileSize;
  }
  return { deleted, size };
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const r = await app.db.row`SELECT count(*) AS n, sum(size) AS bytes FROM file`.catch(() => undefined);
  const n = Number(r?.n ?? 0), bytes = Number(r?.bytes ?? 0);
  return html.async`<div class=-body>
    <b>${n.toLocaleString("de-CH")}</b> ${app.t`files`}<br>
    <small><u2-bytes>${bytes}</u2-bytes></small>
  </div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { list },
    api,
  },
};
