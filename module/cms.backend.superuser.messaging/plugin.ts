import { getCtx, html, sql, tableRef, unixTime, type App, type HtmlString, type Row } from "../core/mod.ts";
import { backend, renderDashboard, u2 } from "../cms.backend/mod.ts";
import { messages, userMessages } from "../messaging/mod.ts";
import type { Node } from "../cms/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.backend.superuser.messaging";
export const description = "Message journal with recipient-level delivery results.";
export const needs = ["cms.backend", "messaging"];
const OVERVIEW_LIMIT = 100;
const CHANNEL_COLORS: Record<string, string> = {
  email: "--orange",
  sms: "--green",
  telegram: "--blue",
  web_push: "--purple",
};

const RENAMES = {
  "cms.backend.superuser.sms": "cms.backend.superuser.messaging.sms",
  "cms.backend.superuser.telegram": "cms.backend.superuser.messaging.telegram",
  "cms.backend.superuser.web_push": "cms.backend.superuser.messaging.web_push",
};

export async function install({ app }: { app: App }): Promise<void> {
  const parent = await backend.install(app, name, { en: "Messaging", de: "Nachrichten" });
  if (!parent) return;
  const page = sql.id(tableRef("page"));
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    await app.db.exec`UPDATE ${page} SET module = ${newName}, basis = ${parent.id} WHERE module = ${oldName}`;
  }
}

export async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const url = getCtx().req.url.toURL();
  const value = Number(url.searchParams.get("usr"));
  const usrId = Number.isSafeInteger(value) && value > 0 ? value : 0;
  const users = await app.db.query`
    SELECT u.id, u.email, u.firstname, u.lastname
    FROM usr u
    ORDER BY u.lastname, u.firstname, u.email, u.id`;
  const user = users.find((row) => Number(row.id) === usrId);
  const [journal, emails, channels, labels] = await Promise.all([
    user ? userMessages(app, usrId) : url.searchParams.has("usr") ? [] : messages(app, OVERVIEW_LIMIT),
    user && app.modules.get("mail") ? emailMessages(app, user) : [],
    user ? userChannels(app, user) : [],
    Promise.all([app.t`recipients`, app.t`errors`, app.t`User`, app.t`Time`, app.t`Error`, app.t`anonymous`, app.t`group`, app.t`Payload`]),
  ]);
  const rows = [...journal, ...emails].sort((a, b) => Number(b.time) - Number(a.time));
  const query = html.join([...url.searchParams]
    .filter(([key]) => key !== "usr")
    .map(([key, value]) => html`<input type=hidden name="${key}" value="${value}">`));

  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex-grow:0">
      <div class=-head>${app.t`User`}</div>
      <form class=-body method=get action="${url.pathname}">
        ${query}
        <select name=usr>
          <option value="">${app.t`All messages`}</option>
          ${html.join(users.map((row) => html`<option value="${row.id}"${Number(row.id) === usrId ? " selected" : ""}>${userName(row)}</option>`))}
        </select>
        <button>${app.t`Open`}</button>
      </form>
    </div>
    ${user
      ? conversation(node, user, rows, channels, labels)
      : url.searchParams.has("usr")
      ? html.async`<div class=u2-card><div class=-body>${app.t`User not found.`}</div></div>`
      : html.async`<div class=u2-card cms-part=messages>
        <div class=-head>${app.t`Messages`} (${rows.length})</div>
        ${rows.length
          ? html.join(rows.map((row) => message(row, labels, url)))
          : html`<div class=-body>${await app.t`No messages yet.`}</div>`}
      </div>`}
    ${renderDashboard(node)}
  </div>`;
}

async function conversation(
  node: Node,
  user: Row,
  rows: (Row & { deliveries: Row[] })[],
  channels: string[],
  labels: string[],
): Promise<HtmlString> {
  const app = node.app;
  const latest = String(rows[0]?.channel ?? "");
  const selected = channels.includes(latest) ? latest : channels[0];
  return html.async`<div class="u2-card -conversation" cms-part=messages>
    <div class=-head>${app.t`Communication with ${userName(user)}`} (${rows.length})</div>
    <div class=-scroll>
      ${rows.length
        ? html`<table class=-chat><tbody>${html.join(rows.toReversed().map((row) => chatMessage(row, labels)))}</tbody></table>`
        : html`<div class=-body>${await app.t`No messages yet.`}</div>`}
    </div>
    <div>
      ${channels.length ? html.async`<form class="-body -composer">
        <input type=hidden name=usr value="${user.id}">
        <label>
          ${app.t`Channel`}: 
          <select name=channel>
            ${html.join(channels.map((channel) => html`<option value="${channel}"${channel === selected ? " selected" : ""}>${channelName(channel)}</option>`))}
          </select>
        </label>
        <textarea name=text maxlength=4096 rows=3 required placeholder="${app.t`Message`}"></textarea>
        <button type=button data-reply>${app.t`Send`}</button>
      </form>` : html.async`<div class=-body>${app.t`No reachable channel.`}</div>`}
    </div>
  </div>`;
}

function chatMessage(row: Row & { deliveries: Row[] }, labels: string[]): HtmlString {
  const [, errorsLabel, , , , , group] = labels;
  const errors = row.deliveries.filter((delivery) => delivery.error).length;
  const target = messageTarget(row, labels[0], group);
  return html`<tr class="${row.direction === "in" ? "-user" : "-platform"}">
    <td>${row.direction === "in" ? chatBubble(row, errors, errorsLabel, target) : ""}
    <td>${row.direction === "out" ? chatBubble(row, errors, errorsLabel, target) : ""}`;
}

function chatBubble(row: Row, errors: number, errorsLabel: string, target: string): HtmlString {
  return html`<div class="u2-card -bubble"><div class=-body>
    <div class=-text>${readableText(row.data) || "–"}</div>
    <small class=-meta>${u2.time(row.time)} · ${channelBadge(row.channel)}${target ? html` · ${target}` : ""}${errors ? html` · <span class=u2-badge>${errors} ${errorsLabel}</span>` : ""}</small>
  </div></div>`;
}

function message(row: Row & { deliveries: Row[] }, labels: string[], url: URL): HtmlString {
  const [recipients, errorsLabel, user, time, error, anonymous, group, payload] = labels;
  const errors = row.deliveries.filter((delivery) => delivery.error).length;
  const target = row.grp_id ? messageTarget(row, recipients, group) : "";
  const data = readableData(row.data);
  const text = readableText(row.data);
  return html`<details class=-body>
    <summary>
      <b>${row.direction === "out" ? "→" : "←"} ${channelBadge(row.channel)}</b>
      · ${u2.time(row.time)}
      ${target ? html` · ${target}` : ""}
      · ${row.deliveries.length} ${recipients}
      ${errors ? html` · <span class=u2-badge>${errors} ${errorsLabel}</span>` : ""}
    </summary>
    ${text ? html`<p>${text}</p>` : ""}
    <details>
      <summary>${payload}</summary>
      <pre>${data}</pre>
    </details>
    ${row.deliveries.length ? html`<table class=u2-table>
      <thead><tr>
        <th>${user}
        <th>${time}
        <th>${error}
      <tbody>${html.join(row.deliveries.map((delivery) => html`<tr>
        <td>${delivery.usr_id
          ? html`<a href="${userUrl(url, Number(delivery.usr_id))}">${delivery.email ?? "#" + delivery.usr_id}</a>`
          : anonymous}
        <td>${u2.time(delivery.time)}
        <td>${delivery.error ?? ""}`))}
    </table>` : ""}
  </details>`;
}

function messageTarget(row: Row, recipients: string, group: string): string {
  if (row.grp_id) return `[${row.grp_name ?? group} #${row.grp_id}]`;
  const count = Number(row.recipient_count ?? row.deliveries?.length ?? 0);
  return count > 1 ? `[${count} ${recipients}]` : "";
}

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

async function userChannels(app: App, user: Row): Promise<string[]> {
  const usrId = Number(user.id);
  const [telegram, sms, webPush] = await Promise.all([
    app.modules.get("messaging.telegram")
      ? app.db.one`SELECT id FROM telegram_chat WHERE usr_id = ${usrId} LIMIT 1`.catch(() => undefined)
      : undefined,
    app.modules.get("messaging.sms")
      ? app.db.one`SELECT id FROM usr_phone WHERE usr_id = ${usrId} AND verified IS NOT NULL LIMIT 1`.catch(() => undefined)
      : undefined,
    app.modules.get("messaging.web_push")
      ? app.db.one`SELECT id FROM web_push_subscription WHERE usr_id = ${usrId} LIMIT 1`.catch(() => undefined)
      : undefined,
  ]);
  return [telegram && "telegram", sms && "sms", webPush && "web_push", user.email && app.modules.get("mail") && "email"]
    .filter((channel): channel is string => Boolean(channel));
}

function channelName(channel: string): string {
  if (channel === "web_push") return "Web Push";
  if (channel === "email") return "Email";
  if (channel === "sms") return "SMS";
  return channel === "telegram" ? "Telegram" : channel;
}

function channelBadge(channel: unknown): HtmlString {
  const name = String(channel ?? "");
  const color = CHANNEL_COLORS[name];
  return html`<span class=u2-badge${color ? html.raw(` style="--color-dark:var(${color})"`) : ""}>${channelName(name)}</span>`;
}

function userName(user: Row): string {
  const name = [user.firstname, user.lastname].filter(Boolean).join(" ");
  return name ? `${name}${user.email ? " · " + user.email : ""}` : String(user.email ?? "#" + user.id);
}

function userUrl(url: URL, usrId: number): string {
  const user = new URL(url);
  user.searchParams.set("usr", String(usrId));
  return user.pathname + user.search;
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

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render, api } };
