import { hee } from "../core/lib/util.ts";
import { Db } from "../core/lib/Db.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";
import { FileTransformer } from "../core/lib/transform/index.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";
import type { DbField } from "../core/lib/DbField.ts";
import type { DbFile } from "../core/lib/DbFileManager.ts";

export const name = "cms.backend.superuser.dbfiles";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }) {
  const P = await backend.install(app, name);
}

const u2time = (t: unknown) => {
  const d = new Date(typeof t === "number" ? t * 1000 : String(t ?? ""));
  if (isNaN(d.getTime())) return "-";
  const iso = d.toISOString();
  return `<u2-time datetime="${iso}" type=relative minute>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
};


const IMG = new Set(["jpg","jpeg","gif","png","svg","webp"]);
const VID = new Set(["mp4","webm","mov","avi","mkv"]);
const AUD = new Set(["mp3","flac","ogg","aac","wav","m4a"]);
const TXT = new Set(["txt","csv","json","xml","html","htm","css","js","ts","md","yaml","yml","svg"]);

async function mediaPreview(f: DbFile, exists: boolean) {
  if (!exists) return `<span style="color:red">✗</span>`;
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

const aptAttrs = (sysURL: string) => `data-sys-url="${sysURL}"`;

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  const { db, dbFiles: fm } = app;
  const get = ctx.get as Record<string, string>;

  if (get.id) return renderDetail(node, Number(get.id));
  if (vars.delete) await (await fm.file(Number(vars.delete))).remove();
  if (vars.delete_unlinked)    return JSON.stringify(await deleteUnlinkedFs(node));
  if (vars.delete_unlinked_db) return JSON.stringify(await deleteUnlinkedDb(node));

  const children = fileChildren(node);
  const search = get.search ?? "";
  const order  = get.order  ?? "not exists";

  const relSubs = children.map((F: DbField, i: number) =>
    `,(SELECT COUNT(*) FROM ${Db.escapeId(F.table.name)} WHERE ${Db.escapeId(F.name)}=f.id) AS r${i}`).join("");

  const orderSql: Record<string, string> = { newest:"f.log_id DESC", oldest:"f.log_id ASC", changed:"f.log_id_ch DESC", biggest:"f.size DESC" };
  const orderBy = orderSql[order] ?? ["f.size=0 DESC", ...children.map((_: DbField, i: number) => `r${i}`)].join(",");

  let sql = `
    SELECT f.*,log_i.time AS init_time,log_e.time AS edit_time,ui.email AS usr_init_email,ue.email AS usr_edit_email${relSubs}
    FROM file f
      LEFT JOIN log log_i ON log_i.id=f.log_id LEFT JOIN sess sess_i ON sess_i.id=log_i.sess_id LEFT JOIN usr ui ON ui.id=sess_i.usr_id
      LEFT JOIN log log_e ON log_e.id=f.log_id_ch LEFT JOIN sess sess_e ON sess_e.id=log_e.sess_id LEFT JOIN usr ue ON ue.id=sess_e.usr_id
    WHERE 1`;
  const params: unknown[] = [];
  if (search) {
    sql += ` AND (f.name LIKE ? OR f.id LIKE ? OR f.md5 LIKE ? OR ui.email=? OR ue.email=?)`;
    params.push(`%${search}%`, `${search}%`, `${search}%`, search, search);
  }
  sql += ` ORDER BY ${orderBy} LIMIT 1000`;

  const rows = await db.all(sql, params);

  const orderOpts = ["not exists","newest","oldest","changed","biggest"]
    .map(o => `<option${o===order?" selected":""}>${o}</option>`).join("");
  const relHeaders = children.map((F: DbField) => `<th title="${hee(F.table.name+"."+F.name)}">${hee(F.table.name)}`).join("");

  let trs = "";
  for (const row of rows) {
    const f = await fm.file(row.id, row);
    const exists = await f.exists();
    trs += `<tr>
  <td class="-thumb">${await mediaPreview(f, exists as boolean)}
  <td>${row.id}
  <td><a href="?id=${row.id}">${hee(row.name??"")}${!exists?` <small style="color:red">${await app.t`missing`}</small>`:""}</a>
  <td><u2-bytes>${row.size}</u2-bytes>
  ${children.map((_: DbField,i: number) => row[`r${i}`]?`<td title="${row[`r${i}`]}x">◼`:`<td>◻`).join("")}
  <td>${u2time(row.init_time)}<br><small>${hee(row.usr_init_email??"")}</small>
  <td>${u2time(row.edit_time)}<br><small>${hee(row.usr_edit_email??"")}</small>
  <td>${await f.used()?"◼":""}
  <td>${row.access?"◼":""}
  <td>
  	<button data-delete="${row.id}" class="u2-unstyle" u2-confirm><u2-ico icon="delete">x</u2-ico></button>`;
  }

  return `
<div class="u2-flex -m-cms-backend-superuser-dbfiles" ${aptAttrs(ctx.sysURL)}>
  <div class="u2-card -sidebar">
    <div class="-head">${await app.t`Filter`}</div>
    <div class="-body">
      <label>${await app.t`Search`}<br><input value="${hee(search)}" data-search></label><br><br>
      <label>${await app.t`Order`}<br><select data-order>${orderOpts}</select></label>
    </div>
    <div class="-head">${await app.t`Actions`}</div>
    <div class="-body">
      <button data-action="delete_unlinked">${await app.t`Delete files without DB entry`}</button><br>
      <small>${await app.t`Files in version history will not be deleted.`}</small><br><br>
      <button data-action="delete_unlinked_db">${await app.t`Delete DB entries without link`}</button><br>
      <small>${await app.t`Warning: only files older than 7 days.`}</small>
    </div>
  </div>
  <div class="u2-card -main">
    <div class="-body">${await app.t`Total`}: ${rows.length}</div>
    <div class="-table-wrap">
      <table class="u2-table -Sticky">
        <thead><tr><th>${await app.t`File`}<th>${await app.t`ID`}<th>${await app.t`Name`}<th>${await app.t`Size`}${relHeaders}<th>${await app.t`Created`}<th>${await app.t`Changed`}<th>${await app.t`Used`}<th>${await app.t`Pub`}<th>
        <tbody>${trs}
      </table>
    </div>
  </div>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  if (!await ctx.user?.get("superuser")) return "<div></div>";

  const { db, dbFiles: fm } = app;
  const get = ctx.get;

  const row = await db.row("SELECT * FROM file WHERE id = ?", [id]);
  if (!row) return `<div>${await app.t`File not found`}</div>`;

  const f = await fm.file(id, row);
  if (get.set_name)   await f.setVs({ name: get.set_name });
  if (get.set_public) await f.setVs({ access: get.set_public ? 1 : 0 });
  if (get.set_mime)   await f.setVs({ mime: get.set_mime });

  const exists = await f.exists();

  const linksHtml = (await Promise.all(fileChildren(node).map(async (Field: DbField) => {
    const rows = await db.all(`SELECT * FROM ${Db.escapeId(Field.table.name)} WHERE ${Db.escapeId(Field.name)}=?`, [id]);
    return rows.map((lr) => `<div>${hee(Field.table.name+"."+Field.name)}: ${hee(JSON.stringify(lr))}</div>`).join("");
  }))).join("") || "<div class=-body>none</div>";

  const dupes = await db.all("SELECT id,name FROM file WHERE id!=? AND md5=?", [id, row.md5]);

  const preview = exists ? await mediaView(f) : "";
  const text = exists ? await textView(f) : "";

  return `
<div class="u2-flex -m-cms-backend-superuser-dbfiles" ${aptAttrs(ctx.sysURL)}>

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
          ? `<table class=u2-table><tr><th>${await app.t`ID`}<th>${await app.t`Name`}${dupes.map((d) =>`<tr><td><a href="?id=${d.id}">${d.id}</a><td>${hee(d.name)}`).join("")}</table>`
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
  const dbMd5s = new Set((await db.all("SELECT md5 FROM file WHERE md5 IS NOT NULL")).map((r) => r.md5));
  let deleted = 0, size = 0;
  for await (const e of Deno.readDir(fm.directory)) {
    if (e.name.length < 32 || e.name[0] === "." || dbMd5s.has(e.name)) continue;
    const path = fm.directory + e.name;
    size += (await Deno.stat(path).catch(()=>null))?.size ?? 0;
    await Deno.remove(path).catch(()=>{});
    deleted++;
  }
  return { deleted, size };
}

async function deleteUnlinkedDb(node: Node) {
  const { db, dbFiles: fm } = node.app;
  const ago = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
  const notLinked = db.table("file").children.map((F: DbField) =>
    `file.id NOT IN (SELECT ${Db.escapeId(F.name)} FROM ${Db.escapeId(F.table.name)})`);
  const rows = await db.all(`SELECT file.id FROM file
    LEFT JOIN log log_i ON file.log_id=log_i.id LEFT JOIN log log_e ON file.log_id_ch=log_e.id
    WHERE log_i.time<${ago} AND log_e.time<${ago}${notLinked.length?" AND "+notLinked.join(" AND "):""}`);
  let deleted = 0;
  for (const row of rows) {
    const f = await fm.file(row.id);
    if (!await f.used() && !await f.access()) { await f.remove(); deleted++; }
  }
  return { deleted };
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render } };
