import { basename, extname } from "node:path";
import { mail } from "../mail/mod.ts";
import { typeByExtension } from "../../deps.ts";
import { backend } from "../cms.backend/mod.ts";
import { getCtx, html, type HtmlString, sqlSearch, u2time, unixTime, type App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.mail";
export const needs = ["cms.backend", "mail"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Mail", de: "Mail" });
}

function parseData(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "string") return {};
  try { return JSON.parse(v); }
  catch { return {}; }
}

function hiddenToken(csrfToken: string): HtmlString {
  return html`<input type=hidden name=csrfToken value="${csrfToken}">`;
}

function render(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const id = Number(ctx.req.query.id);
  if (id) return renderDetail(node, id);
  return renderOverview(node);
}

async function renderOverview(node: Node): Promise<HtmlString> {
  const ctx = getCtx();
  const { t, db } = node.app;
  const search = String(ctx.req.query.search ?? "").trim();

  if (ctx.req.body?.csrfToken === ctx.csrfToken) {
    if ("delete_all" in ctx.req.body) {
      await db.query`DELETE FROM mail`;
    }
    if ("delete_before1year" in ctx.req.body) {
      await db.query`DELETE m FROM mail m LEFT JOIN log l ON l.id=m.log_id WHERE COALESCE(l.time,0) < ${unixTime() - 60 * 60 * 24 * 365}`;
    }
  }

  const rows = await listRows(node, search);
  const actions = await html.async`
    <form method=post style="display:inline">
      ${hiddenToken(ctx.csrfToken)}
      <button name=delete_all u2-confirm="${t`Really delete all?`}">${t`Delete all`}</button>
    </form>
    <form method=post style="display:inline">
      ${hiddenToken(ctx.csrfToken)}
      <button name=delete_before1year u2-confirm="${t`Really delete all older than 1 year?`}">${t`Delete older than 1 year`}</button>
    </form>`;

  return html.async`<div class=u2-card>
  <div class=-head>${t`E-Mails`}</div>
  <div class=-body>
    ${t`Maximum 1000 are shown.`}
    <form method=get style="margin-top:10px">
      <input type=search name=search value="${search}" placeholder="${t`Search...`}">
      <button>${t`Search`}</button>
    </form>
    <div style="margin-top:10px">${actions}</div>
  </div>
  <div style="max-height:85vh; overflow:auto; padding:0">
    <table class=u2-table style="white-space:nowrap">
      <thead><tr>
        <th>${t`Created`}
        <th>${t`Subject`}
        <th>${t`Sender`}
        <th>${t`Recipient`}
        <th>${t`Sent`}
        <th>${t`Opened`}
        <th>${t`first time`}
      <tbody>${rows}
    </table>
  </div>
</div>`;
}

async function listRows(node: Node, search: string): Promise<HtmlString> {
  const db = node.app.db;
  const sh = sqlSearch(search, ["m.subject", "m.html", "m.text"], { exact: ["m.id", "m.sender"] });
  const rows = await db.query`
    SELECT m.id,m.log_id,m.subject,m.sender,l.time,
      s.recipient,s.num,s.sent,s.opened,s.opened_min
    FROM mail m
      LEFT JOIN log l ON l.id=m.log_id
      LEFT JOIN (
        SELECT mail_id, MIN(email) recipient, COUNT(*) num,
          SUM(IF(sent,1,0)) sent, SUM(IF(opened,1,0)) opened, MIN(NULLIF(opened,0)) opened_min
        FROM mail_recipient GROUP BY mail_id
      ) s ON s.mail_id=m.id
    WHERE ${sh.where}
    ORDER BY m.id DESC
    LIMIT 1000`;

  const tMoreLabel = await node.app.t`more`;
  const tNoSubject = await node.app.t`no subject`;
  const u = getCtx().req.url.toURL();
  return html.join(rows.map(row => {
    const more = Number(row.num) > 1 ? html` <small>${Number(row.num) - 1} ${tMoreLabel}</small>` : "";
    u.searchParams.set("id", String(row.id));
    return html`<tr u2-href>
      <td>${html.raw(u2time(row.time))}
      <td><a href="${u.search}">${row.subject || `-- ${tNoSubject} --`}</a>
      <td>${row.sender}
      <td>${row.recipient}${more}
      <td>${row.sent || "-"}
      <td>${row.opened || "-"}
      <td><small>${html.raw(u2time(row.opened_min))}</small>`;
  }));
}

async function renderDetail(node: Node, id: number): Promise<HtmlString> {
  const ctx = getCtx();
  const { t, db } = node.app;
  const row = await db.row`SELECT m.*, l.time FROM mail m LEFT JOIN log l ON l.id=m.log_id WHERE m.id=${id}`;
  if (!row) return html.async`<div class=u2-card><div class=-body>${t`Mail does not exist.`}</div></div>`;

  if (ctx.req.body?.csrfToken === ctx.csrfToken) {
    const msg = await mail(node.app).get(id);
    if ("send" in ctx.req.body) await msg.send();
    const add = String(ctx.req.body.add_recipient ?? "").trim();
    if (add) {
      msg.addTo(add);
      await msg.save();
    }
  }

  const todo = Number(await db.one`SELECT count(*) FROM mail_recipient WHERE mail_id=${id} AND sent=0 AND COALESCE(type,'to')='to'`);
  const attachments = await renderAttachments(node, id);
  const recipients = await renderRecipients(node, id);
  const tracking = await renderTracking(node, id);
  const preview = await renderPreview(node, id);

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex-basis:800px">
    <div class=-head>${t`Mail details`}</div>
    <table class=u2-table>
      <tr><td style="width:100px">${t`Date`}<td>${html.raw(u2time(row.time))} <small>${row.log_id}</small>
      <tr><td>${t`Subject`}<td>${row.subject}
      <tr><td>${t`Sender`}<td>${row.sender}
      <tr><td>${t`Reply to`}<td>${row.reply_to}
      <tr><td>${t`Send`}<td>
        ${todo
          ? html.async`<form method=post style="display:inline">${hiddenToken(ctx.csrfToken)}<button name=send u2-confirm="${t`Send the e-mails?`}">${t`Send`} (${todo})</button></form>`
          : t`all sent`}
        <form method=post style="display:inline; margin-left:10px">
          ${hiddenToken(ctx.csrfToken)}
          <input type=email name=add_recipient placeholder="${t`Add recipient`}">
          <button>${t`add`}</button>
        </form>
      <tr><td colspan=2 style="padding:10px">${preview}
    </table>
  </div>
  ${attachments}
  ${recipients}
  ${tracking}
</div>`;
}

async function renderPreview(node: Node, id: number): Promise<HtmlString> {
  const msg = await mail(node.app).get(id);
  let body = await msg.getHtml(undefined, msg.data);
  const files = await node.app.db.query`SELECT * FROM mail_attachment WHERE mail_id=${id} AND inline=${true}`;
  for (const f of files) {
    if (!f.path || !f.hash) continue;
    try {
      const bytes = await Deno.readFile(f.path);
      const mime = f.type || typeByExtension(extname(f.path).replace(/^\./, "")) || "application/octet-stream";
      const data = btoa(String.fromCharCode(...bytes));
      body = body.replaceAll(`cid:${f.hash}`, `data:${mime};base64,${data}`);
    } catch { /* ignore missing inline files */ }
  }
  return html`<iframe sandbox srcdoc="${body}" style="border:none; background:#fff; width:100%; height:500px; box-sizing:border-box; box-shadow:0 0 8px rgba(0,0,0,.25); display:block"></iframe>`;
}

async function renderAttachments(node: Node, id: number): Promise<HtmlString | string> {
  const files = await node.app.db.query`SELECT * FROM mail_attachment WHERE mail_id=${id}`;
  if (!files.length) return "";
  const rows = html.join(files.map(f => html`<div style="padding:7px 0">
    ${f.name || basename(f.path || "")}
    ${f.inline ? html`<small>(inline)</small>` : ""}
    <br><small>${f.path}</small>
  </div>`));
  return html.async`<div class=u2-card>
    <div class=-head>${node.app.t`Attachments`}</div>
    <div class=-body>${rows}</div>
  </div>`;
}

async function renderRecipients(node: Node, id: number): Promise<HtmlString> {
  const t = node.app.t;
  const rows = await node.app.db.query`SELECT r.*, u.id usr_id FROM mail_recipient r LEFT JOIN usr u ON r.email=u.email WHERE r.mail_id=${id} ORDER BY r.email`;
  const trs = html.join(rows.map(r => {
    const data = parseData(r.data);
    const dataHtml = html.join(Object.entries(data).map(([k, v]) => html`${k}: ${String(v)}<br>`));
    return html`<tr>
      <td>${r.email}
      <td>${r.type || "to"}
      <td>${html.raw(u2time(r.sent))}
      <td>${html.raw(u2time(r.opened))}
      <td>${r.error}
      <td><div style="overflow:auto; max-height:60px; font-size:10px">${dataHtml}</div>`;
  }));
  return html.async`<div class=u2-card style="flex:1 1 500px">
    <div class=-head>${t`Recipients`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table style="white-space:nowrap">
        <thead><tr><th>${t`Recipient`}<th>${t`Type`}<th>${t`Sent`}<th>${t`Opened`}<th>${t`Error`}<th>${t`Data`}
        <tbody>${trs}
      </table>
    </div>
  </div>`;
}

async function renderTracking(node: Node, id: number): Promise<HtmlString | string> {
  const t = node.app.t;
  const rows = await node.app.db.query`
    SELECT t.url, count(t.id) num, max(t.time) last_time
    FROM mail1_track t
      INNER JOIN mail_recipient r ON r.mail1_track_id=t.track_id
    WHERE r.mail_id=${id}
    GROUP BY t.url
    ORDER BY last_time DESC`.catch(() => []);
  if (!rows.length) return "";
  const trs = html.join(rows.map(r => html`<tr>
    <td><a href="${r.url}" target=_blank>${r.url || "(open)"}</a>
    <td>${r.num}
    <td>${html.raw(u2time(r.last_time))}
  `));
  return html.async`<div class=u2-card style="flex:1 1 500px">
    <div class=-head>${t`Tracking`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table style="white-space:nowrap">
        <thead><tr><th>${t`Link`}<th>${t`Views`}<th>${t`Last`}
        <tbody>${trs}
      </table>
    </div>
  </div>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  const { t, db } = app;
  return html.async`<div style="overflow:auto; padding:0">
<table class=u2-table style="white-space:nowrap">
  <tr><td>${t`Mails`}:<td>${db.one`SELECT count(*) FROM mail`.catch(() => 0)}
  <tr><td>${t`Pending`}:<td>${db.one`SELECT count(*) FROM mail_recipient WHERE sent=0`.catch(() => 0)}
  <tr><td>${t`Errors`}:<td>${db.one`SELECT count(*) FROM mail_recipient WHERE error!=''`.catch(() => 0)}
</table>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
