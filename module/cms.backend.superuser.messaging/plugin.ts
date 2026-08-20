import { getCtx, html, sql, sqlSearch, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";
import { channel, channels, userChannels, userMessages } from "@qino/qino/messaging";

import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Channel } from "@qino/qino/messaging";

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
    <div class=u2-card style="flex-basis:60rem">
      <div class=-head>${app.t`Messages`}</div>
      <div class=-body>
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
            <th>${view.recipients}
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
  const sh = sqlSearch(search, ["m.data"], { exact: ["m.id", "m.channel"] });
  const where = filter ? sql`${sh.where} AND m.channel = ${filter}` : sh.where;
  const [rows, view] = await Promise.all([
    app.db.query`
      SELECT m.id, m.channel, m.direction, m.grp_id, m.data, m.time, g.name AS grp_name,
        (SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id) AS recipient_count,
        (SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id AND d.error IS NOT NULL) AS error_count
      FROM message m
      LEFT JOIN grp g ON g.id = m.grp_id
      WHERE ${where}
      ORDER BY m.time DESC, m.id DESC
      LIMIT ${LIST_LIMIT}`,
    labels(app),
  ]);
  if (!rows.length) return html`<tr><td colspan=6>${search || filter ? view.noMatch : view.noMessages}`;

  const pageUrl = await (await node.page()).url();
  const msgUrl = (id: unknown) => pageUrl + (pageUrl.includes("?") ? "&" : "?") + "msg=" + id;
  return html.join(rows.map((row) => {
    const errors = Number(row.error_count) || 0;
    const target = messageTarget(row, view);
    return html`<tr u2-href>
      <td><a href="${msgUrl(row.id)}">${row.id}</a>
      <td style="white-space:nowrap">${u2.el.time(row.time)}
      <td style="white-space:nowrap">${direction(row, view)} ${view.badge(row.channel)}
      <td>${cut(readableText(row.data))}${target ? html` <small>${target}</small>` : ""}
      <td>${Number(row.recipient_count) || 0}
      <td>${errors ? html`<span class=u2-badge>${errors}</span>` : ""}`;
  }));
}

/** One message with its payload and the result per recipient. */
async function renderMessage(node: Node, id: number, url: URL): Promise<HtmlString> {
  const app = node.app;
  const [row, deliveries, view] = await Promise.all([
    app.db.row`SELECT m.*, g.name AS grp_name FROM message m LEFT JOIN grp g ON g.id = m.grp_id WHERE m.id = ${id}`,
    app.db.query`
      SELECT d.usr_id, d.address, d.time, d.error, u.email
      FROM message_delivery d LEFT JOIN usr u ON u.id = d.usr_id
      WHERE d.message_id = ${id} ORDER BY d.id`,
    labels(app),
  ]);
  if (!row) return html.async`<div class=u2-card><div class=-body>${app.t`Message does not exist.`}</div></div>`;

  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex-basis:50rem">
      <div class=-head>${app.t`Message`} #${row.id}</div>
      <table class=u2-table>
        <tr><td>${view.time}<td>${u2.el.time(row.time)}
        <tr><td>${app.t`Type`}<td>${direction(row, view)} ${view.badge(row.channel)} ${messageTarget(row, view)}
        <tr><td>${app.t`Text`}<td style="white-space:pre-wrap">${readableText(row.data) || "–"}
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
            <th>${view.error}
          <tbody>${deliveries.map((d) => html`<tr>
            <td>${d.usr_id
              ? html`<a href="${paramUrl(url, { usr: String(d.usr_id), msg: "" })}">${d.email ?? "#" + d.usr_id}</a>`
              : view.anonymous}
            <td>${d.address ?? ""}
            <td>${u2.el.time(d.time)}
            <td>${d.error ?? ""}`)}
        </table>
      </div>
    </div>
  </div>`;
}

async function renderConversation(node: Node, usrId: number, url: URL): Promise<HtmlString> {
  const app = node.app;
  const user = await app.db.row`SELECT id, email, firstname, lastname FROM usr WHERE id = ${usrId}`;
  if (!user) {
    return html.async`<div class=u2-flex>
      ${userCard(node, url, 0)}
      <div class=u2-card><div class=-body>${app.t`User not found.`}</div></div>
    </div>`;
  }
  const [journal, emails, reachable, view] = await Promise.all([
    userMessages(app, usrId),
    channel(app, "email") ? emailMessages(app, user) : [],
    userChannels(app, usrId),
    labels(app),
  ]);
  const rows = [...journal, ...emails].sort((a, b) => Number(b.time) - Number(a.time));

  return html.async`<div class=u2-flex>
    ${userCard(node, url, usrId)}
    <div class="u2-card -conversation" style="flex-basis:80rem">
      <div class=-head>${app.t`Communication with ${userName(user)}`} (${rows.length})</div>
      <div class=-scroll>
        ${rows.length
          ? html`<table class=-chat><tbody>${rows.toReversed().map((row) => chatMessage(row, view))}</table>`
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
          <button type=button data-reply>${app.t`Send`}</button>
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
    SELECT u.id, u.email, u.firstname, u.lastname
    FROM usr u
    ORDER BY u.lastname, u.firstname, u.email, u.id`;
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

function chatMessage(row: Row & { deliveries: Row[] }, view: View): HtmlString {
  const bubble = chatBubble(row, view);
  return html`<tr class="${row.direction === "in" ? "-user" : "-platform"}">
    <td>${row.direction === "in" ? bubble : ""}
    <td>${row.direction === "out" ? bubble : ""}`;
}

function chatBubble(row: Row & { deliveries: Row[] }, view: View): HtmlString {
  const errors = row.deliveries.filter((delivery) => delivery.error).length;
  const target = messageTarget(row, view);
  return html`<div class="u2-card -bubble"><div class=-body>
    <div class=-text>${readableText(row.data) || "–"}</div>
    <small class=-meta>${u2.el.time(row.time)} · ${view.badge(row.channel)}${target ? html` · ${target}` : ""}${errors ? html` · <span class=u2-badge>${errors} ${view.errors}</span>` : ""}</small>
  </div></div>`;
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

function cut(text: string, max = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
}

/** Everything the row renderers need besides the row: translated labels and channel badges. */
async function labels(app: App) {
  const [recipients, errors, user, time, error, anonymous, group, payload, noMatch, noMessages, incoming, outgoing] = await Promise
    .all([app.t`Recipients`, app.t`Errors`, app.t`User`, app.t`Time`, app.t`Error`, app.t`anonymous`, app.t`group`, app.t`Payload`,
      app.t`No matching messages`, app.t`No messages yet.`, app.t`incoming`, app.t`outgoing`]);
  const known = new Map(channels(app).map((c) => [c.name, c]));
  return {
    recipients, errors, user, time, error, anonymous, group, payload, noMatch, noMessages, incoming, outgoing,
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

function readableText(data: unknown): string {
  try {
    const value = JSON.parse(String(data));
    const text = value?.msg?.text ?? value?.text ?? [value?.msg?.title, value?.msg?.body].filter(Boolean).join("\n");
    return [value?.subject, text].filter(Boolean).join("\n\n");
  } catch {
    return "";
  }
}

async function emailMessages(app: App, user: Row): Promise<(Row & { deliveries: Row[] })[]> {
  const rows = await app.db.query`
    SELECT m.id, m.subject, m.text, m.html, r.email, r.sent, r.opened, r.error, l.time AS created,
      (SELECT COUNT(*) FROM mail_recipient recipients WHERE recipients.mail_id = m.id) AS recipient_count
    FROM mail_recipient r
    JOIN mail m ON m.id = r.mail_id
    LEFT JOIN log l ON l.id = m.log_id
    WHERE (r.usr_id = ${user.id} OR (r.usr_id IS NULL AND r.email = ${user.email}))
      AND (r.sent > 0 OR r.error <> ${""})
    ORDER BY r.sent DESC, m.id DESC`;
  return rows.map((row) => {
    const time = Number(row.sent) || Number(row.created) || 0;
    return {
      id: "email:" + row.id,
      channel: "email",
      direction: "out",
      grp_id: null,
      grp_name: null,
      log_id: null,
      data: JSON.stringify({ subject: row.subject, text: row.text, html: row.html, opened: row.opened }),
      time,
      recipient_count: row.recipient_count,
      deliveries: [{ usr_id: user.id, email: row.email, time, error: row.error || null }],
    };
  });
}

function userName(user: Row): string {
  const name = [user.firstname, user.lastname].filter(Boolean).join(" ");
  return name ? `${name}${user.email ? " · " + user.email : ""}` : String(user.email ?? "#" + user.id);
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const since = unixTime() - 7 * 86400;
  const totals = await app.db.row`
    SELECT COUNT(*) AS n,
      SUM(CASE WHEN direction = ${"in"} THEN 1 ELSE 0 END) AS incoming,
      (SELECT COUNT(*) FROM message_delivery WHERE error IS NOT NULL AND time >= ${since}) AS errors
    FROM message WHERE time >= ${since}`.catch(() => undefined);
  return html.async`<div class=-body>
    <b>${Number(totals?.n ?? 0)}</b> ${app.t`messages in 7 days`}
    · ${Number(totals?.incoming ?? 0)} ${app.t`incoming`}
    ${Number(totals?.errors ?? 0) ? html` · <span class=u2-badge>${totals!.errors} ${await app.t`errors`}</span>` : ""}
  </div>`;
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render, parts: { list }, api } };
