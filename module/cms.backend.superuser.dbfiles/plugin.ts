import { hee, getCtx, sql, u2time, unixTime, FileTransformer, type App, type DbField, type DbFile, type Ctx } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.superuser.dbfiles";
export const needs = ["cms.backend"];
export { healthChecks } from "./healthChecks.ts";

export async function install({ app }: { app: App }) {
  await backend.install(app, name, { en: "DB Files", de: "DB Dateien" });
}


const IMG = new Set(["jpg","jpeg","gif","png","svg","webp"]);
const VID = new Set(["mp4","webm","mov","avi","mkv"]);
const AUD = new Set(["mp3","flac","ogg","aac","wav","m4a"]);
const TXT = new Set(["txt","csv","json","xml","html","htm","css","js","ts","md","yaml","yml","svg"]);

async function mediaPreview(f: DbFile, exists: boolean) {
  if (!exists) return `<u2-ico inline icon=cancel aria-label="not found" style="color:red">✗</u2-ico>`;
  return `<img src="${await f.url({w:70,h:40,max:true,page:1,frame:1})}" alt="">`;
}

async function mediaView(f: DbFile) {
  const ext = f.extension;
  const url = await f.url();
  let inner = "";
  if (IMG.has(ext) && await FileTransformer.capabilities.magick)
    inner = `<img src="${url}" class="-preview-img" alt="">`;
  else if (VID.has(ext))
    inner = `<video src="${url}" controls style="max-width:100%"></video>`;
  else if (AUD.has(ext))
    inner = `<audio src="${url}" controls></audio>`;
  else if (ext === "pdf")
    inner = `<iframe src="${url}" style="width:100%;height:600px;border:0"></iframe>`;
  return inner ? `<div class="u2-card" style="flex:0 1 auto"><div class="-body">${inner}</div></div>` : "";
}

async function textView(f: DbFile) {
  if (!TXT.has(f.extension)) return "";
  return `<div class="u2-card" style="flex:0 1 auto"><div class="-body"><u2-code trim><textarea>${hee(String(await f.contents()))}</textarea></u2-code></div></div>`;
}

const fileChildren = (node: Node) => node.app.db.table("file").children.filter(
  (f: DbField) => f.table.name !== "log" && f.table.name !== "mail_file"
);

// "not exists" sorts by the correlated relation-count subqueries → scans the whole table,
// so it is selectable but never the default; the others are index-backed (log_id / size).
const ORDERS = ["newest", "oldest", "changed", "biggest", "not exists"];

// list (filterable part): total + table rows, reloaded on search/order change
async function list(node: Node, { ctx, vars = {} }: { ctx?: Ctx; vars?: Record<string, any> } = {}): Promise<string> {
  ctx ??= getCtx();
  const app = node.app;
  const { db, dbFiles: fm } = app;

  const children = fileChildren(node);
  const search = String(vars.search ?? "");
  const order  = String(vars.order  ?? "newest");

  const relSubs = sql.join(children.map((F: DbField, i: number) =>
    sql`,(SELECT COUNT(*) FROM ${sql.id(F.table.name)} WHERE ${sql.id(F.name)}=f.id) AS ${sql.raw("r" + i)}`), "");

  const orderSql: Record<string, string> = { newest:"f.log_id DESC", oldest:"f.log_id ASC", changed:"f.log_id_ch DESC", biggest:"f.size DESC" };
  const orderBy = orderSql[order] ?? ["f.size=0 DESC", ...children.map((_: DbField, i: number) => `r${i}`)].join(",");

  // one indexed path per input shape (never an OR across joined tables, which would full-scan):
  // number → id (PK), 32-hex → md5, contains @ → creator/editor email, else → name fulltext
  let cond = sql.raw("");
  if (search) {
    const s = search.trim();
    const emailSub = (col: string) => sql`${sql.raw(col)} IN (SELECT l.id FROM log l JOIN sess se ON se.id=l.sess_id JOIN usr u ON u.id=se.usr_id WHERE u.email=${s})`;
    if (/^\d+$/.test(s)) cond = sql` AND f.id = ${Number(s)}`;
    else if (/^[0-9a-f]{32}$/i.test(s)) cond = sql` AND f.md5 = ${s}`;
    else if (s.includes("@")) cond = sql` AND (${emailSub("f.log_id")} OR ${emailSub("f.log_id_ch")})`;
    else if (db.dialect === "mysql") cond = sql` AND MATCH(f.name) AGAINST (${s + "*"} IN BOOLEAN MODE)`;
    else cond = sql` AND f.name LIKE ${"%" + s + "%"}`;
  }

  const rows = await db.query`
    SELECT f.*,log_i.time AS init_time,log_e.time AS edit_time,ui.email AS usr_init_email,ue.email AS usr_edit_email${relSubs}
    FROM file f
      LEFT JOIN log log_i ON log_i.id=f.log_id LEFT JOIN sess sess_i ON sess_i.id=log_i.sess_id LEFT JOIN usr ui ON ui.id=sess_i.usr_id
      LEFT JOIN log log_e ON log_e.id=f.log_id_ch LEFT JOIN sess sess_e ON sess_e.id=log_e.sess_id LEFT JOIN usr ue ON ue.id=sess_e.usr_id
    WHERE true${cond}
    ORDER BY ${sql.raw(orderBy)} LIMIT 1000`;

  const relHeaders = children.map((F: DbField) => `<th title="${hee(F.table.name+"."+F.name)}">${hee(F.table.name)}`).join("");

  let trs = "";
  const u = ctx.req.url.toURL();
  for (const row of rows) {
    const f = await fm.file(row.id, row);
    const exists = await f.exists();
    u.searchParams.set("id", String(row.id));
    trs += `<tr u2-href>
  <td class="-thumb">${await mediaPreview(f, !!exists)}
  <td>${row.id}
  <td><a href="${hee(u.search)}">${hee(row.name??"")}${!exists?` <small style="color:red">${await app.t`missing`}</small>`:""}</a>
  <td><u2-bytes>${row.size}</u2-bytes>
  ${children.map((_: DbField,i: number) => row[`r${i}`]?`<td title="${row[`r${i}`]}x">◼`:`<td>◻`).join("")}
  <td>${u2time(row.init_time)}<br><small>${hee(row.usr_init_email??"")}</small>
  <td>${u2time(row.edit_time)}<br><small>${hee(row.usr_edit_email??"")}</small>
  <td>${await f.used()?"◼":""}
  <td>${row.access?"◼":""}
  <td>
    <button data-delete="${row.id}" class="u2-unstyle" u2-confirm><u2-ico icon=delete>✕</u2-ico></button>`;
  }

  return `
<caption>${await app.t`Total`}: ${rows.length}</caption>
<thead><tr><th>${await app.t`File`}<th>${await app.t`ID`}<th>${await app.t`Name`}<th>${await app.t`Size`}${relHeaders}<th>${await app.t`Created`}<th>${await app.t`Changed`}<th>${await app.t`Used`}<th>${await app.t`Pub`}<th>
<tbody>${trs}`;
}

async function runAction(node: Node, doName: string): Promise<string> {
  if (doName === "delete_unlinked") {
    const r = await deleteUnlinkedFs(node);
    return `${r.deleted} ${await node.app.t`files deleted`} <small>(<u2-bytes>${r.size}</u2-bytes>)</small>`;
  }
  if (doName === "delete_unlinked_db") {
    const r = await deleteUnlinkedDb(node.app);
    return `${r.deleted} ${await node.app.t`DB entries deleted`}`;
  }
  return "";
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const { dbFiles: fm } = app;
  const get = ctx.req.query;

  if (get.id) return renderDetail(node, Number(get.id));
  if (vars.delete) await (await fm.file(Number(vars.delete))).remove();

  const message = vars.do ? await runAction(node, String(vars.do)) : "";
  const orderOpts = ORDERS.map(o => `<option>${o}`).join("");

  return `
<div class="u2-flex">
  <div class="u2-card -sidebar">
    <div class="-head">${await app.t`Filter`}</div>
    <div class="-body">
      <form data-filter>
        <label>${await app.t`Search`}<br><input name=search></label><br><br>
        <label>${await app.t`Order`}<br><select name=order>${orderOpts}</select></label>
      </form>
    </div>
    <div class="-head">${await app.t`Actions`}</div>
    <div class="-body">
      ${message ? `<p>${message}</p>` : ""}
      <button data-reload='{"do":"delete_unlinked"}'>${await app.t`Delete files without DB entry`}</button><br>
      <small>${await app.t`Files in version history will not be deleted.`}</small><br><br>
      <button data-reload='{"do":"delete_unlinked_db"}'>${await app.t`Delete DB entries without link`}</button><br>
      <small>${await app.t`Warning: only files older than 7 days.`}</small>
    </div>
  </div>
  <div class="u2-card -main" style="max-height:90vh">
    <table class="u2-table -Sticky" cms-part=list>${await list(node, { ctx, vars: {} })}</table>
  </div>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<string> {
  const ctx = getCtx();
  const app = node.app;

  const { db, dbFiles: fm } = app;
  const get = ctx.req.query;

  const row = await db.row`SELECT * FROM file WHERE id = ${id}`;
  console.log(row)
  if (!row) return `<div>${await app.t`File not found`}</div>`;

  const f = await fm.file(id, row);
  if (get.set_name)   await f.setVs({ name: get.set_name });
  if (get.set_public) await f.setVs({ access: get.set_public ? 1 : 0 });
  if (get.set_mime)   await f.setVs({ mime: get.set_mime });

  const exists = await f.exists();

  const linksHtml = (await Promise.all(fileChildren(node).map(async (Field: DbField) => {
    const rows = await db.query`SELECT * FROM ${sql.id(Field.table.name)} WHERE ${sql.id(Field.name)}=${id}`;
    return rows.map((lr) => `<div>${hee(Field.table.name+"."+Field.name)}: ${hee(JSON.stringify(lr))}</div>`).join("");
  }))).join("") || "<div class=-body>none</div>";

  const dupes = await db.query`SELECT id,name FROM file WHERE id!=${id} AND md5=${row.md5}`;
  const dupeU = ctx.req.url.toURL();

  const preview = exists ? await mediaView(f) : "";
  const text = exists ? await textView(f) : "";

  return `
<div class="u2-flex">

  <div class=u2-flex style="flex-direction:column; ">
    <div class="u2-card" style="flex:0 0 auto">
      <div class="-head">${hee(row.name??"")}</div>
      ${!exists?`<div class="-body" style="color:red">${await app.t`file missing on disk!`}</div>`:""}
      <table class="u2-table -Fields">
        <tr><th>${await app.t`ID`}<td>${row.id}
        <tr>
          <th>${await app.t`Name`}
          <td><input value="${hee(row.name??"")}" data-set="set_name">
        <tr>
          <th>${await app.t`Public`}
          <td><input type=checkbox ${row.access?"checked":""} data-set="set_public">
        <tr>
          <th>${await app.t`Mime`}
          <td><input value="${hee(row.mime??"")}" data-set="set_mime">
        <tr><th>${await app.t`Size`}<td><u2-bytes>${row.size}</u2-bytes> <small>(${Number(row.size).toLocaleString()} bytes)</small>
        <tr><th>${await app.t`MD5`}<td><code>${hee(row.md5??"")}</code>
        <tr><th>${await app.t`URL`}<td><a href="${hee(await f.url())}" target=_blank data-url>${await app.t`open`}</a> <a href="${hee(await f.url({dl:true}))}" download>${await app.t`download`}</a> <button data-copy-url>${await app.t`copy url`}</button>
      </table>
    </div>

    <div class="u2-card" style="flex:0 0 auto">
      <div class=-head>${await app.t`Duplicates`}</div>
      ${dupes.length
          ? `<table class=u2-table><tr><th>${await app.t`ID`}<th>${await app.t`Name`}${dupes.map((d) => { dupeU.searchParams.set("id", String(d.id)); return `<tr><td><a href="${hee(dupeU.search)}">${d.id}</a><td>${hee(d.name)}`; }).join("")}</table>`
          : `<div class=-body>${await app.t`none`}</div>`}
    </div>

    <div class="u2-card" style="flex:0 0 auto">
      <div class=-head>${await app.t`Links`}</div>
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

async function deleteUnlinkedDb(app: App) {
  const { db, dbFiles: fm } = app;
  const ago = unixTime() - 60 * 60 * 24 * 7;
  const notLinked = db.table("file").children.map((F: DbField) =>
    sql`file.id NOT IN (SELECT ${sql.id(F.name)} FROM ${sql.id(F.table.name)})`);
  const rows = await db.query`SELECT file.id FROM file
    LEFT JOIN log log_i ON file.log_id=log_i.id LEFT JOIN log log_e ON file.log_id_ch=log_e.id
    WHERE (log_i.id IS NULL OR log_i.time<${ago}) AND (log_e.id IS NULL OR log_e.time<${ago})${notLinked.length ? sql` AND ${sql.join(notLinked, " AND ")}` : sql.raw("")}`;
  let deleted = 0;
  for (const row of rows) {
    const f = await fm.file(row.id);
    if (!await f.used() && !await f.access()) { await f.remove(); deleted++; }
  }
  return { deleted };
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const r = await app.db.row`SELECT count(*) AS n, sum(size) AS bytes FROM file`.catch(() => undefined);
  const n = Number(r?.n ?? 0), bytes = Number(r?.bytes ?? 0);
  return `<div class=-body>
    <b>${n.toLocaleString("de-CH")}</b> ${await app.t`files`}<br>
    <small><u2-bytes>${bytes}</u2-bytes></small>
  </div>`;
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render, parts: { list } } };
