import { basename, extname } from "node:path";
import type {} from "../mail/mod.ts";
import { typeByExtension } from "../../deps.ts";
import { backend } from "../cms.backend/mod.ts";
import { getCtx, hee, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.mail";
export const needs = ["cms.backend", "mail"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Mail", de: "Mail" });
}

const u2time = (t: unknown) => {
  if (!t) return "-";
  const d = new Date(typeof t === "number" ? t * 1000 : String(t));
  if (isNaN(d.getTime())) return "-";
  const iso = d.toISOString();
  return `<u2-time datetime="${iso}" type=relative minute>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
};

function parseData(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "string") return {};
  try { return JSON.parse(v); }
  catch { return {}; }
}

function hiddenToken(token: string): string {
  return `<input type=hidden name=qgToken value="${hee(token)}">`;
}

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const id = Number(ctx.get.id ?? 0);
  if (id) return renderDetail(node, id);
  return renderOverview(node);
}

async function renderOverview(node: Node): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;
  const isSuperuser = !!(await ctx.user?.get("superuser"));
  const search = String(ctx.get.search ?? "").trim();

  if (ctx.post.qgToken === ctx.token && isSuperuser) {
    if ("delete_all" in ctx.post) {
      await db.query("DELETE FROM mail");
    }
    if ("delete_before1year" in ctx.post) {
      await db.query(
        "DELETE m FROM mail m LEFT JOIN log l ON l.id=m.log_id WHERE COALESCE(l.time,0) < ?",
        [Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 365],
      );
    }
  }

  const rows = await listRows(node, search);
  const superuserActions = isSuperuser ? `
    <form method=post style="display:inline">
      ${hiddenToken(ctx.token)}
      <button name=delete_all u2-confirm="${hee(await app.t`Really delete all?`)}">${await app.t`Delete all`}</button>
    </form>
    <form method=post style="display:inline">
      ${hiddenToken(ctx.token)}
      <button name=delete_before1year u2-confirm="${hee(await app.t`Really delete all older than 1 year?`)}">${await app.t`Delete older than 1 year`}</button>
    </form>` : "";

  return `<div class=u2-card>
  <div class=-head>${await app.t`E-Mails`}</div>
  <div class=-body>
    ${await app.t`Maximum 1000 are shown.`}
    <form method=get style="margin-top:10px">
      <input type=search name=search value="${hee(search)}" placeholder="${await app.t`Search...`}">
      <button>${await app.t`Search`}</button>
    </form>
    ${superuserActions ? `<div style="margin-top:10px">${superuserActions}</div>` : ""}
  </div>
  <div style="max-height:85vh; overflow:auto; padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr>
        <th>${await app.t`Created`}
        <th>${await app.t`Subject`}
        <th>${await app.t`Sender`}
        <th>${await app.t`Recipient`}
        <th>${await app.t`Sent`}
        <th>${await app.t`Opened`}
        <th>${await app.t`first time`}
      <tbody>${rows}
    </table>
  </div>
</div>`;
}

async function listRows(node: Node, search: string): Promise<string> {
  const db = node.app.db;
  const params: unknown[] = [];
  let where = "1";
  if (search) {
    where = "(m.id = ? OR m.sender = ? OR m.subject LIKE ? OR m.html LIKE ? OR m.text LIKE ?)";
    params.push(search, search, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  const rows = await db.all(`
    SELECT m.id,m.log_id,m.subject,m.sender,l.time,
      s.recipient,s.num,s.sent,s.opened,s.opened_min
    FROM mail m
      LEFT JOIN log l ON l.id=m.log_id
      LEFT JOIN (
        SELECT mail_id, MIN(email) recipient, COUNT(*) num,
          SUM(IF(sent,1,0)) sent, SUM(IF(opened,1,0)) opened, MIN(NULLIF(opened,0)) opened_min
        FROM mail_recipient GROUP BY mail_id
      ) s ON s.mail_id=m.id
    WHERE ${where}
    ORDER BY m.id DESC
    LIMIT 1000`, params);

  const tMoreLabel = await node.app.t`more`;
  const tNoSubject = await node.app.t`no subject`;
  const u = getCtx().url;
  return rows.map(row => {
    const more = Number(row.num ?? 0) > 1 ? ` <small>${Number(row.num) - 1} ${tMoreLabel}</small>` : "";
    u.searchParams.set("id", String(row.id));
    return `<tr u2-href>
      <td>${u2time(row.time)}
      <td><a href="${hee(u.search)}">${hee(row.subject || `-- ${tNoSubject} --`)}</a>
      <td>${hee(row.sender ?? "")}
      <td>${hee(row.recipient ?? "")}${more}
      <td>${row.sent || "-"}
      <td>${row.opened || "-"}
      <td><small>${u2time(row.opened_min)}</small>`;
  }).join("");
}

async function renderDetail(node: Node, id: number): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const db = app.db;
  const row = await db.row("SELECT m.*, l.time FROM mail m LEFT JOIN log l ON l.id=m.log_id WHERE m.id=?", [id]);
  if (!row) return `<div class=u2-card><div class=-body>${await app.t`Mail does not exist.`}</div></div>`;

  if (ctx.post.qgToken === ctx.token) {
    const Mail = await node.app.mail.get(id);
    if ("send" in ctx.post) await Mail.send();
    const add = String(ctx.post.add_recipient ?? "").trim();
    if (add) {
      Mail.addTo(add);
      await Mail.save();
    }
  }

  const todo = Number(await db.one("SELECT count(*) FROM mail_recipient WHERE mail_id=? AND sent=0 AND COALESCE(type,'to')='to'", [id]));
  const attachments = await renderAttachments(node, id);
  const recipients = await renderRecipients(node, id);
  const tracking = await renderTracking(node, id);
  const preview = await renderPreview(node, id);

  return `<div class=u2-flex>
  <div class=u2-card style="flex-basis:800px">
    <div class=-head>${await app.t`Mail details`}</div>
    <table class=u2-table>
      <tr><td style="width:100px">${await app.t`Date`}<td>${u2time(row.time)} <small>${hee(row.log_id ?? "")}</small>
      <tr><td>${await app.t`Subject`}<td>${hee(row.subject ?? "")}
      <tr><td>${await app.t`Sender`}<td>${hee(row.sender ?? "")}
      <tr><td>${await app.t`Reply to`}<td>${hee(row.reply_to ?? "")}
      <tr><td>${await app.t`Send`}<td>
        ${todo
          ? `<form method=post style="display:inline">${hiddenToken(ctx.token)}<button name=send u2-confirm="${hee(await app.t`Send the e-mails?`)}">${await app.t`Send`} (${todo})</button></form>`
          : await app.t`all sent`}
        <form method=post style="display:inline; margin-left:10px">
          ${hiddenToken(ctx.token)}
          <input type=email name=add_recipient placeholder="${await app.t`Add recipient`}">
          <button>${await app.t`add`}</button>
        </form>
      <tr><td colspan=2 style="padding:10px">${preview}
    </table>
  </div>
  ${attachments}
  ${recipients}
  ${tracking}
</div>`;
}

async function renderPreview(node: Node, id: number): Promise<string> {
  const Mail = await node.app.mail.get(id);
  let html = await Mail.getHtml(undefined, Mail.data);
  const files = await node.app.db.all("SELECT * FROM mail_attachment WHERE mail_id=? AND inline=1", [id]);
  for (const f of files) {
    if (!f.path || !f.hash) continue;
    try {
      const bytes = await Deno.readFile(f.path);
      const mime = f.type || typeByExtension(extname(f.path).replace(/^\./, "")) || "application/octet-stream";
      const data = btoa(String.fromCharCode(...bytes));
      html = html.replaceAll(`cid:${f.hash}`, `data:${mime};base64,${data}`);
    } catch { /* ignore missing inline files */ }
  }
  return `<iframe sandbox srcdoc="${hee(html)}" style="border:none; background:#fff; width:100%; height:500px; box-sizing:border-box; box-shadow:0 0 8px rgba(0,0,0,.25); display:block"></iframe>`;
}

async function renderAttachments(node: Node, id: number): Promise<string> {
  const files = await node.app.db.all("SELECT * FROM mail_attachment WHERE mail_id=?", [id]);
  if (!files.length) return "";
  const rows = files.map(f => `<div style="padding:7px 0">
    ${hee(f.name || basename(f.path || ""))}
    ${f.inline ? "<small>(inline)</small>" : ""}
    <br><small>${hee(f.path ?? "")}</small>
  </div>`).join("");
  return `<div class=u2-card>
    <div class=-head>${await node.app.t`Attachments`}</div>
    <div class=-body>${rows}</div>
  </div>`;
}

async function renderRecipients(node: Node, id: number): Promise<string> {
  const rows = await node.app.db.all(
    "SELECT r.*, u.id usr_id FROM mail_recipient r LEFT JOIN usr u ON r.email=u.email WHERE r.mail_id=? ORDER BY r.email",
    [id],
  );
  const trs = rows.map(r => {
    const data = parseData(r.data);
    const dataHtml = Object.entries(data).map(([k, v]) => `${hee(k)}: ${hee(String(v))}<br>`).join("");
    return `<tr>
      <td>${hee(r.email ?? "")}
      <td>${hee(r.type || "to")}
      <td>${u2time(r.sent)}
      <td>${u2time(r.opened)}
      <td>${hee(r.error ?? "")}
      <td><div style="overflow:auto; max-height:60px; font-size:10px">${dataHtml}</div>`;
  }).join("");
  return `<div class=u2-card style="flex:1 1 500px">
    <div class=-head>${await node.app.t`Recipients`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table style="white-space:nowrap">
        <thead><tr><th>${await node.app.t`Recipient`}<th>${await node.app.t`Type`}<th>${await node.app.t`Sent`}<th>${await node.app.t`Opened`}<th>${await node.app.t`Error`}<th>${await node.app.t`Data`}
        <tbody>${trs}
      </table>
    </div>
  </div>`;
}

async function renderTracking(node: Node, id: number): Promise<string> {
  const rows = await node.app.db.all(`
    SELECT t.url, count(t.id) num, max(t.time) last_time
    FROM mail1_track t
      INNER JOIN mail_recipient r ON r.mail1_track_id=t.track_id
    WHERE r.mail_id=?
    GROUP BY t.url
    ORDER BY last_time DESC`, [id]).catch(() => []);
  if (!rows.length) return "";
  const trs = rows.map(r => `<tr>
    <td><a href="${hee(r.url ?? "")}" target=_blank>${hee(r.url || "(open)")}</a>
    <td>${hee(String(r.num ?? ""))}
    <td>${u2time(r.last_time)}
  `).join("");
  return `<div class=u2-card style="flex:1 1 500px">
    <div class=-head>${await node.app.t`Tracking`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table style="white-space:nowrap">
        <thead><tr><th>${await node.app.t`Link`}<th>${await node.app.t`Views`}<th>${await node.app.t`Last`}
        <tbody>${trs}
      </table>
    </div>
  </div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const total = Number(await app.db.one("SELECT count(*) FROM mail").catch(() => 0));
  const unsent = Number(await app.db.one("SELECT count(*) FROM mail_recipient WHERE sent=0").catch(() => 0));
  const errors = Number(await app.db.one("SELECT count(*) FROM mail_recipient WHERE error!=''").catch(() => 0));
  return `<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${await app.t`Mails`}:<td>${hee(String(total))}
  <tr><td>${await app.t`Pending`}:<td>${hee(String(unsent))}
  <tr><td>${await app.t`Errors`}:<td>${hee(String(errors))}
</table>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
