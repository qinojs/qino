import { html, typeContacts, unixTime } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { cms } from "@qino/qino/cms";
import { status } from "@qino/qino/cron";
import { pendingContacts, templates, textOf } from "@qino/qino/messaging";

import type { App, HtmlString, ItemProxy, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// The module this panel operates. Its journal channel and the kind of address it delivers to are
// two namespaces that happen to share a word: `message.channel` and `usr_contact.type`.
const MODULE = "messaging.email";
const CHANNEL = "email";
const CONTACT = "email";
const RECENT = 7;

export function render(node: Node): Promise<HtmlString> {
  return html.async`<div class=u2-flex>
  <div class=u2-card cms-part=sending>${sending(node)}</div>
  <div class=u2-card cms-part=inbound>${inbound(node)}</div>
  <div class=u2-card cms-part=send>${send(node)}</div>
  <div class=u2-card cms-part=contacts>${contacts(node)}</div>
  <div class=u2-card cms-part=journal>${journal(node)}</div>
</div>`;
}

// --- settings, straight from the module's own schema -----------------------------------------

/** What the form builder reads of a settings schema node. */
type Schema = { type?: string; enum?: string[]; description?: string; properties?: Record<string, Schema> };

/** The module's own schema — the forms follow it, so a new transport needs no change here. */
export function schema(app: App): Schema {
  return (app.modules.linked(MODULE)?.plugin.settingsSchema ?? {}) as Schema;
}

/** Every leaf below a schema node, as dotted paths. */
export function leaves(node: Schema | undefined, prefix = ""): { path: string; schema: Schema }[] {
  if (!node) return [];
  if (!node.properties) return [{ path: prefix, schema: node }];
  return Object.entries(node.properties).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

/** A value nobody may read back out of the panel — only whether it is set. */
export const isSecret = (path: string): boolean => /pass|secret|token|apikey/i.test(path);

/** Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded. */
async function read(app: App, paths: string[]): Promise<Map<string, unknown>> {
  const values = await Promise.all(paths.map(async (path) => {
    let item: ItemProxy = app.settings[MODULE];
    for (const key of path.split(".")) item = item[key];
    return [path, await item] as const;
  }));
  return new Map(values);
}

/** One label and one control per leaf, named after its dotted path. */
function field(path: string, node: Schema, values: Map<string, unknown>): HtmlString {
  const name = path.split(".").at(-1);
  const value = values.get(path);
  const title = node.description ?? "";
  const control = node.enum
    ? html`<select name="${path}" title="${title}">${node.enum.map((option) =>
      html`<option value="${option}"${option === String(value ?? "") ? html.raw(" selected") : ""}>${option || "—"}</option>`)}</select>`
    : node.type === "boolean"
    ? html`<input type=checkbox name="${path}" title="${title}"${bool(value) ? html.raw(" checked") : ""}>`
    : node.type === "number"
    ? html`<input type=number name="${path}" title="${title}" value="${value ?? ""}">`
    : isSecret(path)
    ? html`<input type=password name="${path}" autocomplete=off title="${title}" placeholder="${value ? "••••••" : ""}">`
    : html`<input name="${path}" title="${title}" value="${value ?? ""}">`;
  return html`${name} ${control}`;
}

const bool = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true";

/** Sender defaults and the transport that carries the mail out. */
export async function sending(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const root = schema(app);
  const all = leaves(root);
  const values = await read(app, all.map((leaf) => leaf.path));
  const own = all.filter((leaf) => !leaf.path.includes("."));
  const transports = Object.entries(root.properties?.transport?.properties ?? {}).filter(([key]) => key !== "type");
  const type = String(values.get("transport.type") ?? "");
  const sender = String(values.get("sender") ?? "");
  const debug = String(values.get("debug_to") ?? "");
  const replyTo = String(values.get("reply_to") || values.get("inbound.address") || "");
  // what send() would do right now, in the same order it decides it
  const state = type ? type : app.dev ? await t`mock (dev)` : await t`nothing goes out`;
  const [noSender, debugLabel, redirected] = await Promise.all([t`no sender`, t`debug`,
    debug ? t`Every mail is redirected to ${debug}; the journal marks each delivery as not reached.` : ""]);

  return html.async`<div class=-head>${t`Sending`} <span class=u2-badge>${state}</span>
    ${sender ? "" : html`<span class=u2-badge>${noSender}</span>`}
    ${debug ? html`<span class=u2-badge>${debugLabel}</span>` : ""}</div>
  <form class=-body>
    <u2-fields>
      ${own.map((leaf) => field(leaf.path, leaf.schema, values))}
      ${t`transport`} <select name="transport.type" data-transport-type title="${await t`Without one a dev app falls back to mock, a production app refuses to send.`}">
        ${(root.properties?.transport?.properties?.type?.enum ?? []).map((option) =>
          html`<option value="${option}"${option === type ? html.raw(" selected") : ""}>${option || "—"}</option>`)}
      </select>
    </u2-fields>
    ${transports.map(([key, sub]) => html`<u2-fields data-transport-fields="${key}"${key === type ? "" : html.raw(" hidden")}>
      ${leaves(sub, `transport.${key}`).map((leaf) => field(leaf.path, leaf.schema, values))}
    </u2-fields>`)}
    <button type=button data-settings-save>${t`Save`}</button>
  </form>
  <div class=-body>
    <small>${t`Replies go to`} <b>${replyTo || await t`nowhere — no reply-to and no inbound address`}</b>.
    ${debug ? html`<br>${redirected}` : ""}</small>
  </div>`;
}

/** The mailbox the app reads, and the cron job that reads it. */
export async function inbound(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const own = leaves(schema(app).properties?.inbound, "inbound");
  const [values, jobs] = await Promise.all([
    read(app, own.map((leaf) => leaf.path)),
    status(app).catch(() => []),
  ]);
  const job = jobs.find((v) => v.id === `${MODULE}:inbox`);
  const receiving = Boolean(values.get("inbound.host")) && Boolean(values.get("inbound.pass"));

  return html.async`<div class=-head>${t`Receiving`}
    <span class=u2-badge>${receiving ? t`polling` : t`off`}</span></div>
  <form class=-body>
    <u2-fields>${own.map((leaf) => field(leaf.path, leaf.schema, values))}</u2-fields>
    <button type=button data-settings-save>${t`Save`}</button>
    <button type=button data-fetch>${t`Fetch now`}</button>
  </form>
  <table class=u2-table>
    <tr>
      <td>${t`Interval`}
      <td>${job?.every ? html`${job.every}s` : "-"}
    <tr>
      <td>${t`Next run`}
      <td>${u2.el.time(job?.nextRun)}
    <tr>
      <td>${t`Last success`}
      <td>${u2.el.time(job?.lastSuccess)}
    <tr>
      <td>${t`Failures`}
      <td>${job?.failures ?? 0}${job?.lastError ? html` <small>${job.lastError}</small>` : ""}
  </table>
  <div class=-body><small>${t`Every message taken over is marked \\Seen — that is the whole bookkeeping, so a message the app crashed on arrives again.`}</small></div>`;
}

/** Only groups and users that have an address are offered; a literal address always works. */
export async function send(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const db = node.app.db;
  const [groupRows, userRows, frames] = await Promise.all([
    db.query`
      SELECT g.id, g.name, COUNT(DISTINCT c.usr_id) AS users
      FROM usr_contact c
      JOIN usr_grp ug ON ug.usr_id = c.usr_id
      JOIN grp g ON g.id = ug.grp_id
      WHERE c.type = ${CONTACT}
      GROUP BY g.id, g.name ORDER BY g.name`,
    db.query`
      SELECT c.usr_id, u.email, COUNT(*) AS addresses
      FROM usr_contact c LEFT JOIN usr u ON u.id = c.usr_id
      WHERE c.type = ${CONTACT}
      GROUP BY c.usr_id, u.email ORDER BY u.email`,
    templates(node.app),
  ]);
  const own = frames.filter((f) => f.channel === CHANNEL);
  const main = own.find((f) => f.main);

  return html.async`<div class=-head>${t`Send mail`}</div>
  <form class=-body>
    <u2-fields>
      ${t`To`} <select name=to>
        <option value=all>${t`All users with an address`}</option>
        <option value=address>${t`This address`}</option>
        <optgroup label="${await t`Groups`}">${groupRows.map((g) =>
          html`<option value="grp:${g.id}">${g.name} (${g.users})</option>`)}</optgroup>
        <optgroup label="${await t`Users`}">${userRows.map((u) =>
          html`<option value="usr:${u.usr_id}">${u.email ?? "#" + u.usr_id} (${u.addresses})</option>`)}</optgroup>
      </select>
      ${t`Address`} <input type=email name=address placeholder="name@example.com">
      ${t`Subject`} <input name=title placeholder="${await t`the first line of the text`}">
      ${t`Template`} <select name=template>
        ${main ? html`<option value="">${await t`default`} (${main.name})</option>` : ""}
        <option value="-">${t`none`}</option>
        ${own.filter((f) => !f.main).map((f) => html`<option value="${f.name}">${f.name}</option>`)}
      </select>
      ${t`Format`} <select name=format>
        <option value="">${t`Text`}</option>
        <option value=md>Markdown</option>
        <option value=html>HTML</option>
      </select>
      ${t`Text`} <textarea name=text required rows=6></textarea>
    </u2-fields>
    <button type=button data-send>${t`Send`}</button>
  </form>`;
}

/** The verified addresses this channel delivers to, and the claims waiting to become one. */
export async function contacts(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const [rows, claims, without, users] = await Promise.all([
    typeContacts(app.db, CONTACT),
    pendingContacts(app, CONTACT),
    app.db.one`SELECT COUNT(*) FROM usr u WHERE NOT EXISTS (
      SELECT 1 FROM usr_contact c WHERE c.usr_id = u.id AND c.type = ${CONTACT})`.catch(() => 0),
    app.db.query`SELECT id, email, firstname, lastname FROM usr ORDER BY lastname, firstname, email, id`,
  ]);
  const labels = {
    approve: await t`Approve without code`,
    main: await t`Make main address`,
    test: await t`Send a test mail`,
    del: await t`Delete this address?`,
    pending: await t`pending`,
    without: await t`users without one`,
  };
  const body = rows.length || claims.length
    ? [...rows.map((c) => contact(c, labels)), ...claims.map((c) => claim(c, labels))]
    : html`<tr><td colspan=6>${await t`No addresses yet — nobody can be reached by mail.`}`;

  return html.async`<div class=-head>${t`Addresses`} (${rows.length})
    ${Number(without) ? html`<span class=u2-badge>${without} ${labels.without}</span>` : ""}</div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`User`}
      <th>${t`Address`}
      <th>${t`Main`}
      <th>${t`Since`}
      <th>${t`Last error`}
      <th>
    <tbody>${body}
  </table>
  <form class=-body>
    <u2-fields>
      ${t`User`} <select name=usr>${users.map((u) => html`<option value="${u.id}">${userName(u)}</option>`)}</select>
      ${t`Address`} <input type=email name=address required placeholder="name@example.com">
    </u2-fields>
    <button type=button data-contact-add>${t`Add`}</button>
    <small>${t`An address added here counts as verified.`}</small>
  </form>`;
}

function contact(c: Row, labels: Record<string, string>): HtmlString {
  return html`<tr>
    <td>${c.email ?? "#" + c.usr_id}
    <td>${c.address}
    <td>${c.main ? "✓" : ""}
    <td>${u2.el.time(c.created)}
    <td>${c.error ? html`<span class=u2-badge title="${c.error}">${String(c.error).slice(0, 24)}</span>` : ""}
    <td>
      ${c.main ? "" : html`<button type=button class=u2-unstyle data-main="${c.address}" title="${labels.main}">★</button>`}
      <button type=button class=u2-unstyle data-test="${c.address}" title="${labels.test}"><u2-ico icon=send>➤</u2-ico></button>
      <button type=button class=u2-unstyle data-delete="${c.address}" u2-confirm="${labels.del}"><u2-ico icon=delete>✕</u2-ico></button>`;
}

/** An address someone claimed but has not proven yet — it belongs to no user until they do. */
function claim(c: Row, labels: Record<string, string>): HtmlString {
  return html`<tr>
    <td>${c.email ?? "#" + c.usr_id}
    <td>${c.address}
    <td>
    <td><span class=u2-badge>${labels.pending}</span>
    <td>
    <td><button type=button class=u2-unstyle data-approve="${c.usr_id}:${c.address}" title="${labels.approve}">✓</button>`;
}

/** What this channel put into the journal — the same rows the messaging panel shows, mail only. */
export async function journal(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const week = unixTime() - RECENT * 86400;
  const [rows, totals, url] = await Promise.all([
    app.db.query`
      SELECT m.id, m.direction, m.title, m.text, m.format, m.time,
        (SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id) AS recipients,
        (SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id AND d.error IS NOT NULL) AS errors
      FROM message m WHERE m.channel = ${CHANNEL} ORDER BY m.time DESC, m.id DESC LIMIT 25`,
    app.db.row`SELECT
        SUM(CASE WHEN direction = ${"out"} THEN 1 ELSE 0 END) AS out,
        SUM(CASE WHEN direction = ${"in"} THEN 1 ELSE 0 END) AS incoming
      FROM message WHERE channel = ${CHANNEL} AND time >= ${week}`.catch(() => undefined),
    messagingUrl(app),
  ]);
  const [outgoing, incoming, nothing] = await Promise.all([t`sent`, t`received`, t`Nothing yet.`]);
  const body = rows.length
    ? rows.map((m) => html`<tr>
      <td>${url ? html`<a href="${url}msg=${m.id}">${m.id}</a>` : m.id}
      <td>${u2.el.time(m.time)}
      <td>${m.direction === "out"
        ? html`<u2-ico inline icon=call_made>→</u2-ico>`
        : html`<u2-ico inline icon=call_received>←</u2-ico>`}
      <td>${m.title ? html`<b>${m.title}</b> ` : ""}${cut(textOf({ text: String(m.text ?? ""), format: m.format || undefined }))}
      <td>${m.recipients}
      <td>${Number(m.errors) ? html`<span class=u2-badge>${m.errors}</span>` : ""}`)
    : html`<tr><td colspan=6>${nothing}`;

  return html.async`<div class=-head>${t`Journal`}
    <span class=u2-badge>${Number(totals?.out ?? 0)} ${outgoing}</span>
    <span class=u2-badge>${Number(totals?.incoming ?? 0)} ${incoming}</span>
    <small>${t`in ${RECENT} days`}</small></div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`Id`}
      <th>${t`Time`}
      <th>
      <th>${t`Text`}
      <th>${t`Recipients`}
      <th>${t`Errors`}
    <tbody>${body}
  </table>`;
}

/** The messaging panel's address, so one journal row opens with its deliveries. */
async function messagingUrl(app: App): Promise<string> {
  const node = await cms(app).nodeByModule("cms.backend.superuser.messaging");
  const url = await (await node?.page())?.url();
  return url ? url + (url.includes("?") ? "&" : "?") : "";
}

function userName(user: Row): string {
  const name = [user.firstname, user.lastname].filter(Boolean).join(" ");
  return name ? `${name}${user.email ? " · " + user.email : ""}` : String(user.email ?? "#" + user.id);
}

function cut(text: string, max = 90): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
}
