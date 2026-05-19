// deno-lint-ignore-file no-explicit-any
import { hee } from "../core/lib/util.ts";
import { Db } from "../core/lib/Db.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";
import { FileTransformer } from "../core/lib/transform/index.ts";
import type { Node } from "../cms/lib/Node.ts";

export const name = "cms.backend.superuser.dbfiles";
export const needs = ["cms.backend"];

export async function install({ app }: any) {
  const P = await backend.install(app, name);
  if (P) { await P.title("en", "DB-Files"); await P.title("de", "DB-Files"); }
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

async function mediaPreview(f: any, exists: boolean) {
  if (!exists) return `<span style="color:red">✗</span>`;
  const ext = f.extension;
  if (IMG.has(ext) && await FileTransformer.capabilities.magick)
    return `<img src="${await f.url({w:70,h:40,max:true,page:1})}" style="display:block;max-width:70px;max-height:40px" alt="">`;
  if (VID.has(ext) && await FileTransformer.capabilities.ffmpeg)
    return `<img src="${await f.url()}/w-70/h-40/fmt-jpeg/frame-1/${hee(f.name)}" style="display:block" alt="">`;
  if (AUD.has(ext)) return `<audio src="${await f.url()}" style="width:70px">`;
  return `<svg width=70 height=40 style="display:block"><rect width=70 height=40 fill="var(--cms-color)"></rect><text x=35 y=25 fill="#fff" text-anchor=middle>${hee(ext||"?")}</text></svg>`;
}

async function mediaLarge(f: any) {
  const ext = f.extension;
  const url = await f.url();
  let inner = "";
  if (IMG.has(ext) && await FileTransformer.capabilities.magick)
    inner = `<img src="${url}/w-800/h-600/max/${hee(f.name)}" style="max-width:100%;display:block">`;
  else if (VID.has(ext))
    inner = `<video src="${url}" controls style="max-width:100%"></video>`;
  else if (AUD.has(ext))
    inner = `<audio src="${url}" controls></audio>`;
  else if (ext === "pdf")
    inner = `<iframe src="${url}" style="width:100%;height:600px;border:0"></iframe>`;
  if (!inner) return "";
  return `<div class="u2-card" style="flex:0 1 auto"><div class="-body">${inner}</div></div>`;
}

const fileChildren = (node: Node) => node.app.db.table("file").children.filter(
  (f: any) => f.table.name !== "log" && f.table.name !== "mail_file"
);

const aptScript = (sysURL: string) =>
  `<script type=module>import{apt}from'${sysURL}core/pub/js/apt.js';globalThis.apt=apt;</script>`;

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<string> {
  const ctx = getCtx() as any;
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  const { db, dbFiles: fm } = node.app;
  const get = ctx.get as Record<string, string>;

  if (get.id) return renderDetail(node, Number(get.id));
  if (vars.delete) await (await fm.file(Number(vars.delete))).remove();
  if (vars.delete_unlinked)    return JSON.stringify(await deleteUnlinkedFs(node));
  if (vars.delete_unlinked_db) return JSON.stringify(await deleteUnlinkedDb(node));

  const children = fileChildren(node);
  const search = get.search ?? "";
  const order  = get.order  ?? "not exists";

  const relSubs = children.map((F: any, i: number) =>
    `,(SELECT COUNT(*) FROM ${Db.escapeId(F.table.name)} WHERE ${Db.escapeId(F.name)}=f.id) AS r${i}`).join("");

  const orderSql: Record<string, string> = { newest:"f.log_id DESC", oldest:"f.log_id ASC", changed:"f.log_id_ch DESC", biggest:"f.size DESC" };
  const orderBy = orderSql[order] ?? ["f.size=0 DESC", ...children.map((_: any, i: number) => `r${i}`)].join(",");

  let sql = `SELECT f.*,log_i.time AS init_time,log_e.time AS edit_time,ui.email AS usr_init_email,ue.email AS usr_edit_email${relSubs}
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
  const nid = node.id;

  const orderOpts = ["not exists","newest","oldest","changed","biggest"]
    .map(o => `<option${o===order?" selected":""}>${o}</option>`).join("");
  const relHeaders = children.map((F: any) => `<th title="${hee(F.table.name+"."+F.name)}">${hee(F.table.name)}`).join("");

  let trs = "";
  for (const row of rows) {
    const f = await fm.file(row.id, row);
    const exists = await f.exists();
    trs += `<tr>
  <td style="width:75px">${await mediaPreview(f, exists as boolean)}
  <td>${row.id}
  <td><a href="?id=${row.id}">${hee(row.name??"")}${!exists?` <small style="color:red">missing</small>`:""}</a>
  <td><u2-bytes>${row.size}</u2-bytes>
  ${children.map((_: any,i: number) => row[`r${i}`]?`<td title="${row[`r${i}`]}x">◼`:`<td>◻`).join("")}
  <td>${u2time(row.init_time)}<br><small>${hee(row.usr_init_email??"")}</small>
  <td>${u2time(row.edit_time)}<br><small>${hee(row.usr_edit_email??"")}</small>
  <td>${await f.used()?"◼":""}
  <td>${row.access?"◼":""}
  <td><button onclick="event.stopPropagation();apt.cms.node(${nid}).html.post({vars:{delete:${row.id}}}).then(()=>{this.closest('tr').remove()})">✕</button>`;
  }

  return `
<div class="u2-flex" style="height:88vh;align-items:start">
  <div class="u2-card" style="flex:0 0 auto;overflow:auto">
    <div class="-head">Filter</div>
    <div class="-body">
      <label>Search<br><input value="${hee(search)}" oninput="debSearch(this)"></label><br><br>
      <label>Order<br><select onchange="location.search='?order='+this.value">${orderOpts}</select></label>
    </div>
    <div class="-head">Actions</div>
    <div class="-body">
      <button onclick="doAction('delete_unlinked')">Dateien ohne DB-Eintrag löschen</button><br>
      <small>Dateien im Verlauf werden nicht gelöscht.</small><br><br>
      <button onclick="doAction('delete_unlinked_db')">DB-Einträge ohne Verlinkung löschen</button><br>
      <small>Achtung: nur Dateien älter 7 Tage.</small>
    </div>
  </div>
  <div class="u2-card" style="flex:1 1 auto;overflow:auto">
    <div class="-body">Total: ${rows.length}</div>
    <div style="padding:0;overflow:auto;max-height:80vh">
      <table class="u2-table">
        <thead><tr><th>File<th>ID<th>Name<th>Size${relHeaders}<th>Created<th>Changed<th>Used<th>Pub<th>
        <tbody>${trs}
      </table>
    </div>
  </div>
</div>
${aptScript(ctx.sysURL)}
<script>
let debTimer;
globalThis.debSearch = inp => { clearTimeout(debTimer); debTimer = setTimeout(()=>location.href='?search='+encodeURIComponent(inp.value)+'&order=${hee(order)}',400); };
globalThis.doAction = async (key,btn=event.currentTarget) => {
  btn.disabled=true;
  const r = await apt.cms.node(${nid}).html.post({vars:{[key]:1}});
  btn.disabled=false;
  alert(JSON.stringify(JSON.parse(r),null,2));
};
</script>`;
}

async function renderDetail(node: Node, id: number): Promise<string> {
  const ctx = getCtx() as any;
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  const { db, dbFiles: fm } = node.app;
  const get = ctx.get as Record<string, string>;

  const row = await db.row("SELECT * FROM file WHERE id = ?", [id]);
  if (!row) return "<div>File not found</div>";

  const f = await fm.file(id, row);
  if (get.set_name)   await f.setVs({ name: get.set_name });
  if (get.set_public) await f.setVs({ access: get.set_public ? 1 : 0 });
  if (get.set_mime)   await f.setVs({ mime: get.set_mime });

  const exists = await f.exists();
  const nid = node.id;

  console.log("file.children", db.table("file").children.map((f:any)=>f.table.name+"."+f.name));
  const linksHtml = (await Promise.all(fileChildren(node).map(async (Field: any) => {
    const rows = await db.all(`SELECT * FROM ${Db.escapeId(Field.table.name)} WHERE ${Db.escapeId(Field.name)}=?`, [id]);
    return rows.map((lr: any) => `<div>${hee(Field.table.name+"."+Field.name)}: ${hee(JSON.stringify(lr))}</div>`).join("");
  }))).join("") || "<div class=-body>keine</div>";

  const dupes = await db.all("SELECT id,name FROM file WHERE id!=? AND md5=?", [id, row.md5]);

  const preview = exists ? await mediaLarge(f) : "";

  return `
<div class=u2-flex>

  <div class="u2-card" style="flex:0 0 auto">
    <div class="-head">${hee(row.name??"")}</div>
    ${!exists?'<div class="-body" style="color:red">file missing on disk!</div>':""}
    <table class="u2-table -Fields">
      <tr><th>ID<td>${row.id}
      <tr>
        <th>Name
        <td><input value="${hee(row.name??"")}" onchange="apt.cms.node(${nid}).html.post({vars:{set_name:this.value}})">
      <tr>
        <th>Public
        <td><input type=checkbox ${row.access?"checked":""} onchange="apt.cms.node(${nid}).html.post({vars:{set_public:this.checked?1:0}})">
      <tr>
        <th>Mime
        <td><input value="${hee(row.mime??"")}" onchange="apt.cms.node(${nid}).html.post({vars:{set_mime:this.value}})" style="width:100%">
      <tr><th>Size<td><u2-bytes>${row.size}</u2-bytes> <small>(${Number(row.size).toLocaleString()} bytes)</small>
      <tr><th>MD5<td><code>${hee(row.md5??"")}</code>
      <tr><th>URL<td><a href="${hee(await f.url())}" target=_blank>open</a> <a href="${hee(await f.url({dl:true}))}" download>download</a> <button onclick="navigator.clipboard.writeText('${hee(await f.url())}')">copy url</button>
    </table>
  </div>

  <div class="u2-card" style="flex:0 0 auto">
    <div class=-head>Duplikate</div>
    ${dupes.length
        ? `<table class="u2-table"><tr><th>ID<th>Name${dupes.map((d: any)=>`<tr><td><a href="?id=${d.id}">${d.id}</a><td>${hee(d.name)}`).join("")}</table>`
        : "<div class=-body>keine</div>"}
  </div>

  <div class="u2-card" style="flex:0 0 auto">
    <div class=-head>Verknüpfungen</div>
    ${linksHtml}
  </div>

  ${preview}

</div>
${aptScript(ctx.sysURL)}`;
}

async function deleteUnlinkedFs(node: Node) {
  const { db, dbFiles: fm } = node.app;
  const dbMd5s = new Set((await db.all("SELECT md5 FROM file WHERE md5 IS NOT NULL")).map((r: any) => r.md5));
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
  const notLinked = db.table("file").children.map((F: any) =>
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

export const cms = { node: { render } };
