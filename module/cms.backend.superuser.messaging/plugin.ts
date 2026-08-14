import { getCtx, html, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";
import { channel, channels, messages, userChannels, userMessages } from "@qino/qino/messaging";

import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Channel } from "@qino/qino/messaging";

const { name } = manifest;

const OVERVIEW_LIMIT = 100;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Messaging", de: "Nachrichten" });
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
  const [journal, emails, reachable, view] = await Promise.all([
    user ? userMessages(app, usrId) : url.searchParams.has("usr") ? [] : messages(app, OVERVIEW_LIMIT),
    user && channel(app, "email") ? emailMessages(app, user) : [],
    user ? userChannels(app, usrId) : [],
    labels(app),
  ]);
  const rows = [...journal, ...emails].sort((a, b) => Number(b.time) - Number(a.time));
  const query = [...url.searchParams]
    .filter(([key]) => key !== "usr")
    .map(([key, value]) => html`<input type=hidden name="${key}" value="${value}">`);

  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex-grow:0">
      <div class=-head>${app.t`User`}</div>
      <form class=-body method=get action="${url.pathname}">
        ${query}
        <select name=usr>
          <option value="">${app.t`All messages`}</option>
          ${users.map((row) => html`<option value="${row.id}"${Number(row.id) === usrId ? " selected" : ""}>${userName(row)}</option>`)}
        </select>
        <button>${app.t`Open`}</button>
      </form>
    </div>
    ${user
      ? conversation(node, user, rows, reachable, view)
      : url.searchParams.has("usr")
      ? html.async`<div class=u2-card><div class=-body>${app.t`User not found.`}</div></div>`
      : html.async`<div class=u2-card cms-part=messages>
        <div class=-head>${app.t`Messages`} (${rows.length})</div>
        ${rows.length
          ? rows.map((row) => message(row, view, url))
          : html`<div class=-body>${await app.t`No messages yet.`}</div>`}
      </div>`}
    ${renderDashboard(node)}
  </div>`;
}

async function conversation(
  node: Node,
  user: Row,
  rows: (Row & { deliveries: Row[] })[],
  reachable: Channel[],
  view: View,
): Promise<HtmlString> {
  const app = node.app;
  const latest = String(rows[0]?.channel ?? "");
  const selected = reachable.some((c) => c.name === latest) ? latest : reachable[0]?.name;
  return html.async`<div class="u2-card -conversation" cms-part=messages>
    <div class=-head>${app.t`Communication with ${userName(user)}`} (${rows.length})</div>
    <div class=-scroll>
      ${rows.length
        ? html`<table class=-chat><tbody>${rows.toReversed().map((row) => chatMessage(row, view))}</tbody></table>`
        : html`<div class=-body>${await app.t`No messages yet.`}</div>`}
    </div>
    <div>
      ${reachable.length ? html.async`<form class="-body -composer">
        <input type=hidden name=usr value="${user.id}">
        <label>
          ${app.t`Channel`}:
          <select name=channel>
            ${reachable.map((c) => html`<option value="${c.name}"${c.name === selected ? " selected" : ""}>${c.label}</option>`)}
          </select>
        </label>
        <textarea name=text maxlength=4096 rows=3 required placeholder="${app.t`Message`}"></textarea>
        <button type=button data-reply>${app.t`Send`}</button>
      </form>` : html.async`<div class=-body>${app.t`No reachable channel.`}</div>`}
    </div>
  </div>`;
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

function message(row: Row & { deliveries: Row[] }, view: View, url: URL): HtmlString {
  const { recipients, errors: errorsLabel, user, time, error, anonymous, payload } = view;
  const errors = row.deliveries.filter((delivery) => delivery.error).length;
  const target = row.grp_id ? messageTarget(row, view) : "";
  const data = readableData(row.data);
  const text = readableText(row.data);
  return html`<details class=-body>
    <summary>
      <b>${row.direction === "out" ? "→" : "←"} ${view.badge(row.channel)}</b>
      · ${u2.el.time(row.time)}
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
      <tbody>${row.deliveries.map((delivery) => html`<tr>
        <td>${delivery.usr_id
          ? html`<a href="${userUrl(url, Number(delivery.usr_id))}">${delivery.email ?? "#" + delivery.usr_id}</a>`
          : anonymous}
        <td>${u2.el.time(delivery.time)}
        <td>${delivery.error ?? ""}`)}
    </table>` : ""}
  </details>`;
}

function messageTarget(row: Row, view: View): string {
  if (row.grp_id) return `[${row.grp_name ?? view.group} #${row.grp_id}]`;
  const count = Number(row.recipient_count ?? row.deliveries?.length ?? 0);
  return count > 1 ? `[${count} ${view.recipients}]` : "";
}

/** Everything the row renderers need besides the row: translated labels and channel badges. */
async function labels(app: App) {
  const [recipients, errors, user, time, error, anonymous, group, payload] = await Promise.all(
    [app.t`recipients`, app.t`errors`, app.t`User`, app.t`Time`, app.t`Error`, app.t`anonymous`, app.t`group`, app.t`Payload`],
  );
  const known = new Map(channels(app).map((c) => [c.name, c]));
  return {
    recipients, errors, user, time, error, anonymous, group, payload,
    /** A channel's own label and colour; an unlinked channel keeps the name the journal stored. */
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
