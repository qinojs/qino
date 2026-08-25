import { getCtx, html, sql, sqlSearch, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";
import { channels, htmlOf, sanitizeHtml, textOf, userChannels, userMessages } from "@qino/qino/messaging";

import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Channel, Msg } from "@qino/qino/messaging";

const { name } = manifest;

const LIST_LIMIT = 100;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Messaging", de: "Nachrichten" });
}

export function render(node: Node): Promise<HtmlString> {
  const url = getCtx().req.url.toURL();
  const msgId = intParam(url, "msg");
  if (msgId) return renderMessage(node, msgId, url);
  const usrId = intParam(url, "usr");
  if (usrId) return renderConversation(node, usrId, url);
  return renderOverview(node, url);
}

function intParam(url: URL, key: string): number {
  const value = Number(url.searchParams.get(key));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** The journal as a table: one row per logical message, filtered by text and channel. */
async function renderOverview(node: Node, url: URL): Promise<HtmlString> {
  const app = node.app;
  const ctx = getCtx();
  const search = String(url.searchParams.get("search") ?? "");
  const filter = String(url.searchParams.get("channel") ?? "");
  const [used, view] = await Promise.all([
    app.db.col<string>`SELECT DISTINCT channel FROM message ORDER BY channel`,
    labels(app),
  ]);

  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:0 1 auto">
      <div class=-head>${app.t`Messages`}</div>
      <div>
        <form method=get data-filter>
          ${hidden(url, ["search", "channel", "usr", "msg"])}
          <input type=search name=search value="${search}" placeholder="${app.t`Search...`}">
          <select name=channel>
            <option value="">${app.t`All types`}</option>
            ${used.map((c) => html`<option value="${c}"${c === filter ? " selected" : ""}>${view.label(c)}</option>`)}
          </select>
          <button>${app.t`Search`}</button>
        </form>
      </div>
      <div style="overflow:auto; padding:0">
        <table class=u2-table>
          <thead><tr>
            <th>${app.t`Id`}
            <th>${view.time}
            <th>${app.t`Type`}
            <th>${app.t`Text`}
            <th>${view.attachments}
            <th>${view.recipients}
            <th>${app.t`Opened`}
            <th>${app.t`Clicks`}
            <th>${view.errors}
          <tbody cms-part=list>${list(node, { ctx, vars: { search, channel: filter } })}
        </table>
      </div>
    </div>
    ${userCard(node, url, 0)}
    ${renderDashboard(node)}
  </div>`;
}

// List part - re-rendered live on search/filter input via cms.reloadPart(nid, "list", form values).
async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = ctx.app;
  const search = String(vars.search ?? "").trim();
  const filter = String(vars.channel ?? "");
  const sh = sqlSearch(search, ["m.title", "m.text"], { exact: ["m.id", "m.channel"] });
  const where = filter ? sql`${sh.where} AND m.channel = ${filter}` : sh.where;
  const rows = await app.db.query`
    SELECT m.id, m.channel, m.direction, m.grp_id, m.title, m.text, m.data, m.time, g.name AS grp_name,
      (SELECT COUNT(*) FROM message_attachment a WHERE a.message_id = m.id) AS attachment_count,
      (SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id) AS recipient_count,
      (SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id AND d.error IS NOT NULL) AS error_count
    FROM message m
    LEFT JOIN grp g ON g.id = m.grp_id
    WHERE ${where}
    ORDER BY m.time DESC, m.id DESC
    LIMIT ${LIST_LIMIT}`;
  const [tracked, view] = await Promise.all([trackingStats(app, rows), labels(app)]);
  if (!rows.length) return html`<tr><td colspan=9>${search || filter ? view.noMatch : view.noMessages}`;

  const pageUrl = await (await node.page()).url();
  const msgUrl = (id: unknown) => pageUrl + (pageUrl.includes("?") ? "&" : "?") + "msg=" + id;
  return html.join(rows.map((row) => {
    const errors = Number(row.error_count) || 0;
    const target = messageTarget(row, view);
    const stats = tracked.get(Number(row.id));
    return html`<tr u2-href>
      <td><a href="${msgUrl(row.id)}">${row.id}</a>
      <td style="white-space:nowrap">${u2.el.time(row.time)}
      <td style="white-space:nowrap">${direction(row, view)} ${view.badge(row.channel)}
      <td>${row.title ? html`<b>${cut(String(row.title), 60)}</b> ` : ""}${cut(plain(row))}${target ? html` <small>${target}</small>` : ""}
      <td data-attachments>${Number(row.attachment_count) || 0}
      <td>${Number(row.recipient_count) || 0}
      <td style="white-space:nowrap">${trackedStat(stats?.opened_count, stats?.opened_first)}
      <td style="white-space:nowrap">${trackedStat(stats?.clicked_count, stats?.clicked_first)}
      <td>${errors ? html`<span class=u2-badge>${errors}</span>` : ""}`;
  }));
}

/** Recipient counts and first hits for the messages currently visible in the journal. */
async function trackingStats(app: App, rows: Row[]): Promise<Map<number, Row>> {
  if (!rows.length) return new Map();
  const ids = sql.join(rows.map((row) => sql`${row.id}`), ", ");
  const stats = await app.db.query`
    SELECT d.message_id,
      COUNT(DISTINCT CASE WHEN t.kind = ${"load"} THEN t.delivery_id END) AS opened_count,
      MIN(CASE WHEN t.kind = ${"load"} THEN t.time END) AS opened_first,
      COUNT(DISTINCT CASE WHEN t.kind = ${"click"} THEN t.delivery_id END) AS clicked_count,
      MIN(CASE WHEN t.kind = ${"click"} THEN t.time END) AS clicked_first
    FROM message_delivery d
    JOIN message_track t ON t.delivery_id = d.id
    WHERE d.message_id IN (${ids})
    GROUP BY d.message_id`;
  return new Map(stats.map((row) => [Number(row.message_id), row]));
}

function trackedStat(count: unknown, first: unknown): HtmlString {
  const n = Number(count) || 0;
  return first == null ? html`${n}` : html`${n}<br><small>${u2.el.time(first, { narrow: true })}</small>`;
}

/** One message with its payload and the result per recipient. */
async function renderMessage(node: Node, id: number, url: URL): Promise<HtmlString> {
  const app = node.app;
  const [row, deliveries, files, links, view] = await Promise.all([
    app.db.row`SELECT m.*, g.name AS grp_name FROM message m LEFT JOIN grp g ON g.id = m.grp_id WHERE m.id = ${id}`,
    app.db.query`
      SELECT d.usr_id, d.address, d.time, d.error, u.username,
        (SELECT MIN(t.time) FROM message_track t WHERE t.delivery_id = d.id AND t.kind = ${"load"}) AS opened,
        (SELECT COUNT(*) FROM message_track t WHERE t.delivery_id = d.id AND t.kind = ${"click"}) AS clicks
      FROM message_delivery d LEFT JOIN usr u ON u.id = d.usr_id
      WHERE d.message_id = ${id} ORDER BY d.id`,
    app.db.query`
      SELECT a.file_id, a.sort, f.name, f.mime, f.size
      FROM message_attachment a JOIN file f ON f.id = a.file_id
      WHERE a.message_id = ${id} ORDER BY a.sort, a.file_id`,
    app.db.query`
      SELECT t.code,
        SUM(CASE WHEN t.kind = ${"load"} THEN 1 ELSE 0 END) AS loads,
        SUM(CASE WHEN t.kind = ${"click"} THEN 1 ELSE 0 END) AS clicks
      FROM message_track t
      JOIN message_delivery d ON d.id = t.delivery_id
      WHERE d.message_id = ${id}
      GROUP BY t.code
      ORDER BY t.code`,
    labels(app),
  ]);
  if (!row) return html.async`<div class=u2-card><div class=-body>${app.t`Message does not exist.`}</div></div>`;
  const attachmentList = await attachments(app, files);
  // shorturl knows what a code stands for; without that module the code stands for itself
  const targets = links.length
    ? await app.db.query`SELECT code, url FROM shorturl WHERE code IN (${
      sql.join(links.map((link) => sql`${link.code}`), ", ")
    })`.catch(() => [])
    : [];
  const urls = new Map(targets.map((target) => [target.code, target.url]));

  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex-basis:50rem">
      <div class=-head>${app.t`Message`} #${row.id}</div>
      <table class=u2-table>
        <tr><td>${view.time}<td>${u2.el.time(row.time)}
        <tr><td>${app.t`Type`}<td>${direction(row, view)} ${view.badge(row.channel)} ${messageTarget(row, view)}
        <tr><td>${app.t`Title`}<td>${row.title ?? ""}
        <tr><td>${app.t`Text`}<td${row.format ? "" : html.raw(' style="white-space:pre-wrap"')}>${body(row)}
        ${row.template ? html`<tr><td>${view.template}<td>${row.template}` : ""}
        ${files.length ? html`<tr><td>${view.attachments}<td>${attachmentList}` : ""}
        <tr><td>${view.payload}<td><pre>${readableData(row.data)}</pre>
      </table>
    </div>
    <div class=u2-card style="flex:1 1 31.25rem">
      <div class=-head>${view.recipients} (${deliveries.length})</div>
      <div style="overflow:auto; padding:0">
        <table class=u2-table>
          <thead><tr>
            <th>${view.user}
            <th>${app.t`Address`}
            <th>${view.time}
            <th>${app.t`Opened`}
            <th>${app.t`Clicks`}
            <th>${view.error}
          <tbody>${deliveries.map((d) => html`<tr>
            <td>${recipient(d, url, view)}
            <td>${d.address ?? ""}
            <td>${u2.el.time(d.time)}
            <td>${d.opened ? u2.el.time(d.opened) : ""}
            <td>${Number(d.clicks) || ""}
            <td>${d.error ?? ""}`)}
        </table>
      </div>
    </div>
    ${linkTable(app, links, urls)}
  </div>`;
}

/** Tracked links reached for this message, aggregated across every recipient. */
async function linkTable(app: App, rows: Row[], urls: Map<unknown, unknown>): Promise<HtmlString> {
  const empty = await app.t`No links yet.`;
  return html.async`<div class=u2-card style="flex:1 1 31.25rem">
    <div class=-head>${app.t`Links`}</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table>
        <thead><tr>
          <th>${app.t`Link`}
          <th>${app.t`Loads`}
          <th>${app.t`Clicks`}
        <tbody>${rows.length
          ? rows.map((row) => html`<tr>
            <td>${urls.has(row.code)
              ? html`<a href="${urls.get(row.code)}" target=_blank rel=noreferrer>${urls.get(row.code)}</a>`
              : row.code}
            <td>${row.loads}
            <td>${row.clicks}`)
          : html`<tr><td colspan=3>${empty}`}
      </table>
    </div>
  </div>`;
}

async function renderConversation(node: Node, usrId: number, url: URL): Promise<HtmlString> {
  const app = node.app;
  const user = await app.db.row`SELECT id, username, given_name, family_name FROM usr WHERE id = ${usrId}`;
  if (!user) {
    return html.async`<div class=u2-flex>
      ${userCard(node, url, 0)}
      <div class=u2-card><div class=-body>${app.t`User not found.`}</div></div>
    </div>`;
  }
  const [rows, reachable, view] = await Promise.all([
    userMessages(app, usrId),
    userChannels(app, usrId),
    labels(app),
  ]);
  const messages = await Promise.all(rows.toReversed().map((row) => chatMessage(app, row, view)));

  return html.async`<div class=u2-flex>
    ${userCard(node, url, usrId)}
    <div class="u2-card -conversation" style="flex-basis:80rem">
      <div class=-head>${app.t`Communication with ${userName(user)}`} (${rows.length})</div>
      <div class=-scroll>
        ${rows.length
          ? html`<table class=-chat><tbody>${messages}</table>`
          : html`<div class=-body>${await app.t`No messages yet.`}</div>`}
      </div>
      <div>
        ${reachable.length ? html.async`<form class="-body -composer">
          <input type=hidden name=usr value="${user.id}">
          <label>
            ${app.t`Channel`}:
            <select name=channel>
              ${reachable.map((c) => html`<option value="${c.name}"${c.name === selectedChannel(rows, reachable) ? " selected" : ""}>${c.label}</option>`)}
            </select>
          </label>
          <textarea name=text maxlength=4096 rows=3 required placeholder="${app.t`Message`}"></textarea>
          <label>
            ${app.t`Format`}:
            <select name=format>
              <option value="">${app.t`Text`}</option>
              <option value=md>Markdown</option>
            </select>
          </label>
          <button data-reply>${app.t`Send`}</button>
        </form>` : html.async`<div class=-body>${app.t`No reachable channel.`}</div>`}
      </div>
    </div>
  </div>`;
}

/** The channel the last message used, else the first the user can be reached on. */
function selectedChannel(rows: Row[], reachable: Channel[]): string | undefined {
  const latest = String(rows[0]?.channel ?? "");
  return reachable.some((c) => c.name === latest) ? latest : reachable[0]?.name;
}

async function userCard(node: Node, url: URL, usrId: number): Promise<HtmlString> {
  const app = node.app;
  const users = await app.db.query`
    SELECT u.id, u.username, u.given_name, u.family_name
    FROM usr u
    ORDER BY u.family_name, u.given_name, u.username, u.id`;
  return html.async`<div class=u2-card style="flex-grow:0">
    <div class=-head>${app.t`User`}</div>
    <form class=-body method=get action="${url.pathname}">
      ${hidden(url, ["usr", "msg"])}
      <select name=usr>
        <option value="">${app.t`All messages`}</option>
        ${users.map((row) => html`<option value="${row.id}"${Number(row.id) === usrId ? " selected" : ""}>${userName(row)}</option>`)}
      </select>
      <button>${app.t`Open`}</button>
    </form>
  </div>`;
}

/** Carries the rest of the query string through a GET form; `own` are the fields the form owns. */
function hidden(url: URL, own: string[]): HtmlString[] {
  return [...url.searchParams]
    .filter(([key]) => !own.includes(key))
    .map(([key, value]) => html`<input type=hidden name="${key}" value="${value}">`);
}

function paramUrl(url: URL, params: Record<string, string>): string {
  const next = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value) next.searchParams.set(key, value);
    else next.searchParams.delete(key);
  }
  return next.pathname + next.search;
}

function recipient(row: Row, url: URL, view: View): HtmlString {
  return row.usr_id
    ? html`<a href="${paramUrl(url, { usr: String(row.usr_id), msg: "" })}">${row.username ?? "#" + row.usr_id}</a>`
    : html`${view.anonymous}`;
}

async function chatMessage(app: App, row: Row & { deliveries: Row[]; attachments: Row[] }, view: View): Promise<HtmlString> {
  const bubble = await chatBubble(app, row, view);
  return html`<tr class="${row.direction === "in" ? "-user" : "-platform"}">
    <td>${row.direction === "in" ? bubble : ""}
    <td>${row.direction === "out" ? bubble : ""}`;
}

async function chatBubble(app: App, row: Row & { deliveries: Row[]; attachments: Row[] }, view: View): Promise<HtmlString> {
  const errors = row.deliveries.filter((delivery) => delivery.error).length;
  const target = messageTarget(row, view);
  return html`<div class="u2-card -bubble"><div class=-body>
    <div class=-text>${body(row)}</div>
    ${await attachments(app, row.attachments, true)}
    <small class=-meta>${u2.el.time(row.time)} · ${view.badge(row.channel)}${target ? html` · ${target}` : ""}${errors ? html` · <span class=u2-badge>${errors} ${view.errors}</span>` : ""}</small>
  </div></div>`;
}

async function attachments(app: App, rows: Row[], compact = false): Promise<HtmlString> {
  if (!rows.length) return html``;
  const items = await Promise.all(rows.map(async (row) => {
    const file = await app.dbFiles.file(Number(row.file_id));
    const download = await file.url({ dl: true, grant: "session" });
    const preview = String(row.mime ?? "").startsWith("image/")
      ? await file.url({ fmt: "avif", w: compact ? 180 : 320, h: compact ? 120 : 240, max: true, grant: "session" })
      : "";
    return html`<div class=-attachment>
      ${preview ? html`<a href="${download}" download><img src="${preview}" alt="${row.name ?? ""}" loading=lazy></a>` : ""}
      <a href="${download}" download><u2-ico inline icon=download>↓</u2-ico> ${row.name ?? "#" + row.file_id}</a>
      <small>${row.mime ?? ""}${row.size == null ? "" : html` · <u2-bytes>${row.size}</u2-bytes>`}</small>
    </div>`;
  }));
  return html`<div class=-attachments>${items}</div>`;
}

function messageTarget(row: Row, view: View): string {
  if (row.grp_id) return `[${row.grp_name ?? view.group} #${row.grp_id}]`;
  const count = Number(row.recipient_count ?? row.deliveries?.length ?? 0);
  return count > 1 ? `[${count} ${view.recipients}]` : "";
}

/** Incoming or outgoing, as the call-log icons say it. */
function direction(row: Row, view: View): HtmlString {
  return row.direction === "out"
    ? html`<u2-ico inline icon=call_made aria-label="${view.outgoing}">→</u2-ico>`
    : html`<u2-ico inline icon=call_received aria-label="${view.incoming}">←</u2-ico>`;
}

/** What the message says, without its markup — for previews and search results. */
function plain(row: Row): string {
  return textOf(rowMsg(row));
}

/** The body as the panel shows it: sanitized markup when the message has some, escaped text
 *  otherwise. A message is written by whoever sent it, so nothing here is trusted. */
function body(row: Row): HtmlString {
  const markup = htmlOf(rowMsg(row));
  return markup ? html.raw(sanitizeHtml(markup)) : html`${row.text ?? ""}`;
}

function rowMsg(row: Row): Msg {
  return { text: String(row.text ?? ""), format: (row.format || undefined) as Msg["format"] };
}

function cut(text: string, max = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
}

/** Everything the row renderers need besides the row: translated labels and channel badges. */
async function labels(app: App) {
  const [recipients, errors, user, time, error, anonymous, group, payload, noMatch, noMessages, incoming, outgoing, template, attachments] = await Promise
    .all([app.t`Recipients`, app.t`Errors`, app.t`User`, app.t`Time`, app.t`Error`, app.t`anonymous`, app.t`group`, app.t`Payload`,
      app.t`No matching messages`, app.t`No messages yet.`, app.t`incoming`, app.t`outgoing`, app.t`Template`, app.t`Attachments`]);
  const known = new Map(channels(app).map((c) => [c.name, c]));
  return {
    recipients, errors, user, time, error, anonymous, group, payload, noMatch, noMessages, incoming, outgoing, template, attachments,
    /** A channel's own label; an unlinked channel keeps the name the journal stored. */
    label(channel: unknown): string {
      const name = String(channel ?? "");
      return known.get(name)?.label ?? name;
    },
    /** A channel's own label and colour. */
    badge(channel: unknown): HtmlString {
      const name = String(channel ?? "");
      const c = known.get(name);
      return html`<span class=u2-badge${c?.color ? html.raw(` style="--color-dark:var(${c.color})"`) : ""}>${c?.label ?? name}</span>`;
    },
  };
}
type View = Awaited<ReturnType<typeof labels>>;

function readableData(data: unknown): string {
  try { return JSON.stringify(JSON.parse(String(data)), null, 2); } catch { return String(data ?? ""); }
}

function userName(user: Row): string {
  const name = [user.given_name, user.family_name].filter(Boolean).join(" ");
  return name ? `${name}${user.username ? " · " + user.username : ""}` : String(user.username ?? "#" + user.id);
}

export async function backendDashboardWidget(app: App, page?: Node): Promise<HtmlString> {
  const since = unixTime() - 7 * 86400;
  const [totals, recent, view, pageUrl] = await Promise.all([
    app.db.row`
      SELECT COUNT(*) AS n,
        SUM(CASE WHEN direction = ${"in"} THEN 1 ELSE 0 END) AS incoming,
        (SELECT COUNT(*) FROM message_delivery WHERE error IS NOT NULL AND time >= ${since}) AS errors
      FROM message WHERE time >= ${since}`.catch(() => undefined),
    app.db.query`
      SELECT m.id, m.channel, m.direction, m.grp_id, m.title, m.text, m.format, m.time, g.name AS grp_name,
        (SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id) AS recipient_count,
        (SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id AND d.error IS NOT NULL) AS error_count
      FROM message m LEFT JOIN grp g ON g.id = m.grp_id
      ORDER BY m.time DESC, m.id DESC LIMIT 5`.catch(() => []),
    labels(app),
    page?.url() ?? "",
  ]);
  return html.async`<div class=-body>
    <b>${Number(totals?.n ?? 0)}</b> ${app.t`messages in 7 days`}
    · ${Number(totals?.incoming ?? 0)} ${app.t`incoming`}
    ${Number(totals?.errors ?? 0) ? html` · <span class=u2-badge>${totals!.errors} ${await app.t`errors`}</span>` : ""}
  </div>
  ${recent.length ? html`<div style="overflow:auto;padding:0"><table class=u2-table>${recent.map((row) => {
    const errors = Number(row.error_count) || 0;
    const target = messageTarget(row, view);
    const title = cut(String(row.title || plain(row) || "#" + row.id), 70);
    const href = pageUrl ? pageUrl + (pageUrl.includes("?") ? "&" : "?") + "msg=" + row.id : "";
    return html`<tr${href ? html.raw(" u2-href") : ""}>
      <td style="white-space:nowrap">${direction(row, view)} ${view.badge(row.channel)}
      <td>${href ? html`<a href="${href}">${title}</a>` : title}${target ? html` <small>${target}</small>` : ""}
      <td style="white-space:nowrap">${u2.el.time(row.time, { narrow: true })}
      <td>${errors ? html`<span class=u2-badge>${errors} ${view.errors}</span>` : ""}`;
  })}</table></div>` : ""}`;
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render, parts: { list }, api } };
