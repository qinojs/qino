import { addContact, contactKey, contactOwner, getCtx, hee, html, modulePlaceholders, Output, placeholderNames, safeEqual, sql, sqlSearch, unixTime } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { backend } from "@qino/qino/cms.backend";
import { record, release, template, templated, unsubscribeCode } from "@qino/qino/messaging";
import { failureText, send } from "@qino/qino/messaging.email";

import { CHANNEL, TYPE } from "./setup.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString, Row, Sql } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// A list is a group of type newsletter, an issue is a mail to it: a draft until it has deliveries.

const { name: NS } = manifest;
const LIMIT = 500;

/** The address a member receives on: the main one, else the oldest — as messaging picks it. */
const MAIN = sql`c.address = (SELECT o.address FROM usr_contact o
  WHERE o.type = ${CHANNEL} AND o.usr_id = c.usr_id ORDER BY o.main DESC, o.created, o.address LIMIT 1)`;

export function render(node: Node): Promise<HtmlString | string> {
  const query = getCtx().req.query;
  const issue = idOf(query.issue), list = idOf(query.list);
  return node.app.t.with(NS, () => issue ? issueView(node, issue) : list ? listView(node, list) : overview(node));
}

/** Links to this page, absolute: they hold wherever the node is shown. */
async function here(node: Node) {
  const url = await (await node.page()).url();
  return (params?: Record<string, unknown>) => backend.toUrl(url, params);
}

const idOf = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;

/** The form fields, if the post is ours. */
function posted(ctx: Ctx): Record<string, unknown> | undefined {
  const post = ctx.req.body;
  return post && safeEqual(post.csrfToken, ctx.csrfToken) ? post : undefined;
}

const str = (value: unknown) => String(value ?? "").trim();
const csrf = (ctx: Ctx) => html`<input type=hidden name=csrfToken value="${ctx.csrfToken}">`;

// --- overview -------------------------------------------------------------------------------

async function overview(node: Node) {
  const app = node.app, t = app.t, ctx = getCtx(), to = await here(node);
  const post = posted(ctx);
  if (post && "createList" in post && str(post.name)) {
    return redirect(to({ list: await app.db.table("grp").insert({ name: str(post.name), type: TYPE }) }));
  }
  if (post && "createIssue" in post && await isList(app, Number(post.grp))) {
    return redirect(to({ issue: await draft(app, Number(post.grp)) }));
  }
  const [lists, issues] = await Promise.all([listRows(app), issueRows(app)]);

  return html.async`<div class=u2-flex style="flex-basis:100%">
  <div class=u2-card style="flex:1 1 45rem">
    <div class=-head>${t`Newsletters`}</div>
    ${lists.length ? html.async`<form method=post class=-inline>
      ${csrf(ctx)}
      <select name=grp aria-label="${t`List`}">${lists.map((l) => html`<option value="${l.id}">${l.name}</option>`)}</select>
      <button name=createIssue>${t`New newsletter`}</button>
    </form>` : ""}
    ${issues.length ? html.async`<table class=u2-table>
      <thead><tr>
        <th>${t`Subject`}
        <th>${t`List`}
        <th>${t`Status`}
        <th>${t`Recipients`}
        <th>${t`Opened`}
        <th>${t`Clicked`}
      <tbody>${issues.map((row) => html.async`<tr u2-href>
        <td><a href="${to({ issue: row.id })}">${str(row.title) || t`(no subject)`}</a>
        <td>${row.list}
        <td>${status(app, row)}
        <td>${Number(row.recipients) || html.async`<small title="${t`Would receive it now`}">${Number(row.reachable)}</small>`}
        <td>${share(row.opened, row.reached)}
        <td>${share(row.clicked, row.reached)}`)}
    </table>` : start(node, lists)}
  </div>
  <div class=u2-card style="flex:0 1 22rem">
    <div class=-head>${t`Lists`}</div>
    <form method=post class=-inline>
      ${csrf(ctx)}
      <input name=name required placeholder="${t`Name of the new list`}">
      <button name=createList>${t`Create`}</button>
    </form>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Name`}
        <th>${t`Subscribers`}
        <th>${t`Bounced`}
      <tbody>${lists.length ? lists.map((row) => html`<tr u2-href>
        <td><a href="${to({ list: row.id })}">${row.name}</a>
        <td>${Number(row.members)}
        <td>${Number(row.bounced) || ""}`) : html.async`<tr><td colspan=3>${t`No lists yet.`}`}
    </table>
  </div>
</div>`;
}

/** Members of the list a send would reach now: with an address that has not bounced. */
const reachable = (grp: Sql | unknown) => sql`(SELECT COUNT(*) FROM usr_grp ug
  JOIN usr_contact c ON c.usr_id = ug.usr_id AND c.type = ${CHANNEL} AND ${MAIN} AND c.error IS NULL
  WHERE ug.grp_id = ${grp})`;

/** Before the first newsletter: what is ready and what is still to do, each with its way there. */
async function start(node: Node, lists: Row[]) {
  const app = node.app, t = app.t;
  const [frame, signup, templates, self] = await Promise.all([
    draftTemplate(app),
    node.cms.nodeByModule("cms.cont.newsletter"),
    backend.toModuleUrl(node, "cms.backend.superuser.messaging.templates"),
    here(node),
  ]);
  const members = lists.reduce((sum, l) => sum + Number(l.members), 0);
  const list = lists[0];
  const step = (done: unknown, body: unknown) => html.async`<li${done ? html.raw(" class=-done") : ""}>${body}`;
  const to = (url: string, label: unknown) => url ? html.async`<a href="${url}">${label}</a>` : label;
  return html.async`<ol class=-start>
    ${step(list, list ? html.async`${t`A list:`} <a href="${self({ list: list.id })}">${list.name}</a>` : t`Create a list — on the right.`)}
    ${step(frame, frame
      ? html.async`${t`A template:`} ${to(templates({ name: frame.name, channel: CHANNEL }), frame.name)} — ${t`adjust it to your liking.`}`
      : t`A template — the health check creates one.`)}
    ${step(members, html.async`${members ? t`${members} subscribers.` : t`No subscribers yet:`}
      ${list ? html.async`<a href="${self({ list: list.id })}">${t`Add subscribers`}</a>` : ""}
      ${signup ? "" : html.async`${t`or put the signup form (Newsletter) on a page.`}`}`)}
    ${step(false, t`Write the first newsletter — with "New newsletter" above.`)}
  </ol>`;
}

const isList = async (app: App, id: number) => !!id && !!await app.db.one`SELECT id FROM grp WHERE id = ${id} AND type = ${TYPE}`;

/** Every list (or one) with the members it reaches and how many of those bounced. */
function listRows(app: App, id?: number) {
  return app.db.query`
    SELECT g.id, g.name, COUNT(c.usr_id) AS members, COUNT(c.error) AS bounced
    FROM grp g
    LEFT JOIN usr_grp ug ON ug.grp_id = g.id
    LEFT JOIN usr_contact c ON c.usr_id = ug.usr_id AND c.type = ${CHANNEL} AND ${MAIN}
    WHERE g.type = ${TYPE} ${id ? sql`AND g.id = ${id}` : sql``}
    GROUP BY g.id, g.name ORDER BY g.name`;
}

/** Issues with their delivery counts and, per recipient, whether they opened or clicked. A click
 *  also counts as open: clients block the pixel, not links. */
async function issueRows(app: App, id?: number) {
  const of = (condition: Sql) => sql`(SELECT COUNT(*) FROM message_delivery d WHERE d.message_id = m.id AND ${condition})`;
  const rows = await app.db.query`
    SELECT m.id, m.title, m.text, m.template, m.time, m.grp_id, g.name AS list,
      ${of(sql`${true}`)} AS recipients, ${reachable(sql`m.grp_id`)} AS reachable,
      ${of(sql`d.sent IS NULL AND d.due IS NOT NULL`)} AS pending,
      ${of(sql`d.error IS NOT NULL`)} AS failed,
      ${of(sql`d.sent IS NOT NULL AND d.error IS NULL`)} AS reached,
      (SELECT MIN(d.due) FROM message_delivery d WHERE d.message_id = m.id AND d.sent IS NULL) AS due
    FROM message m
    JOIN grp g ON g.id = m.grp_id AND g.type = ${TYPE}
    WHERE m.channel = ${CHANNEL} AND m.direction = ${"out"} ${id ? sql`AND m.id = ${id}` : sql``}
    ORDER BY m.time DESC, m.id DESC LIMIT ${LIMIT}`;
  if (!rows.length) return rows;
  const hits = new Map((await app.db.query`
    SELECT d.message_id, COUNT(DISTINCT t.delivery_id) AS opened,
      COUNT(DISTINCT CASE WHEN t.kind = ${"click"} THEN t.delivery_id END) AS clicked,
      COUNT(DISTINCT CASE WHEN t.code = ${unsubscribeCode} THEN t.delivery_id END) AS unsubscribed
    FROM message_delivery d JOIN message_track t ON t.delivery_id = d.id
    WHERE ${sql.in("d.message_id", rows.map((row) => row.id))}
    GROUP BY d.message_id`).map((row) => [Number(row.message_id), row]));
  for (const row of rows) {
    const hit = hits.get(Number(row.id));
    row.opened = hit?.opened ?? 0;
    row.clicked = hit?.clicked ?? 0;
    row.unsubscribed = hit?.unsubscribed ?? 0;
  }
  return rows;
}

function status(app: App, row: Row) {
  const t = app.t;
  if (!Number(row.recipients)) return html.async`<span class=u2-badge>${t`Draft`}</span>`;
  if (Number(row.pending)) {
    return Number(row.due) > unixTime()
      ? html.async`<span class=u2-badge style="--color-dark:var(--blue)">${t`Scheduled`}</span> ${u2.el.time(row.due)}`
      : html.async`<span class=u2-badge style="--color-dark:var(--orange)">${t`Sending`}</span>`;
  }
  return html.async`<span class=u2-badge style="--color-dark:var(--green)">${t`Sent`}</span> ${u2.el.time(row.time)}`;
}

const percent = (count: unknown, of: unknown) => Number(of) ? html`<small>${Math.round(100 * Number(count) / Number(of))}%</small>` : "";
const share = (count: unknown, of: unknown) => Number(of) ? html`${Number(count)} ${percent(count, of)}` : "";

/** Whether the message is a newsletter draft: nothing went out yet, so it may change. */
export const isDraft = async (app: App, id: number) => !!await app.db.one`SELECT m.id FROM message m
  JOIN grp g ON g.id = m.grp_id AND g.type = ${TYPE}
  WHERE m.id = ${id} AND m.channel = ${CHANNEL} AND m.direction = ${"out"}
    AND NOT EXISTS (SELECT 1 FROM message_delivery d WHERE d.message_id = m.id)`;

/** The template a new draft gets: the newsletter one if there is one, else the main one. */
export function draftTemplate(app: App): Promise<{ name: string; text: string } | undefined> {
  return app.db.row<{ name: string; text: string }>`SELECT name, text FROM message_template
    WHERE channel = ${CHANNEL} AND (name = ${TYPE} OR main = ${true})
    ORDER BY CASE WHEN name = ${TYPE} THEN 0 ELSE 1 END LIMIT 1`;
}

/** A new draft to the list, in the draft template, or a copy of `from`. */
async function draft(app: App, grpId: number, from?: Row) {
  const template = from ? from.template : (await draftTemplate(app))?.name;
  const { id } = await record(app, {
    channel: CHANNEL,
    direction: "out",
    grpId,
    data: { to: { grp: grpId } },
    // the template is named, not left to the default: a draft is sent later, from its stored row
    msg: { title: str(from?.title), text: String(from?.text ?? ""), format: "html", template: template ?? null },
  });
  return id;
}

// --- issue ----------------------------------------------------------------------------------

async function issueView(node: Node, id: number) {
  const app = node.app, t = app.t, ctx = getCtx(), to = await here(node);
  let [row] = await issueRows(app, id);
  if (!row) return html.async`<div class=u2-card><div>${t`Newsletter not found.`}</div></div>`;
  const post = posted(ctx);
  const isDraft = !Number(row.recipients);
  let notice: unknown = "";

  if (post && isDraft) {
    if ("delete" in post) {
      await app.db.exec`DELETE FROM message WHERE id = ${id}`;
      return redirect(to());
    }
    await save(app, id, post);
    if ("save" in post) return redirect(to({ issue: id }));
    [row] = await issueRows(app, id);
    if ("test" in post) notice = await test(app, row, str(post.address));
    if ("send" in post || "schedule" in post) {
      const at = "schedule" in post ? Number(post.at) : unixTime();
      if (!(at > 0)) notice = html.async`<u2-alert open variant=warning>${t`Choose when to send it.`}</u2-alert>`;
      else if ("schedule" in post && at <= unixTime()) notice = html.async`<u2-alert open variant=warning>${t`Choose a time in the future.`}</u2-alert>`;
      else if (!str(row.title)) notice = html.async`<u2-alert open variant=warning>${t`The newsletter needs a subject.`}</u2-alert>`;
      else {
        await release(app, id, at);
        [row] = await issueRows(app, id);
        if (!Number(row.recipients)) notice = html.async`<u2-alert open variant=warning>${t`Nobody on this list has an address.`}</u2-alert>`;
        else return redirect(to({ issue: id }));
      }
    }
  }
  if (post && !isDraft) {
    if ("duplicate" in post) return redirect(to({ issue: await draft(app, Number(row.grp_id), row) }));
    // only while nothing went out: the deliveries go, the message is a draft again
    if ("cancel" in post && !Number(row.reached)) {
      await app.db.exec`DELETE FROM message_delivery WHERE message_id = ${id}`;
      return redirect(to({ issue: id }));
    }
  }
  return Number(row.recipients) ? report(node, row) : editor(node, row, notice);
}

/** Store the editor's fields; the list only changes to another list. */
export async function save(app: App, id: number, post: Record<string, unknown>) {
  const grpId = Number(post.grp);
  const list = await isList(app, grpId) ? { grp_id: grpId, data: JSON.stringify({ to: { grp: grpId } }) } : {};
  await app.db.table("message").update(id, {
    ...list,
    title: str(post.title).slice(0, 191),
    text: String(post.text ?? ""),
    template: str(post.template) || null,
  });
}

/** Send the issue to one address, outside the list: it has no unsubscribe link. */
async function test(app: App, row: Row, address: string) {
  const t = app.t;
  let error = "";
  const sent = address && await send(app, { email: address }, {
    title: str(row.title) || await t`(no subject)`,
    text: String(row.text ?? ""),
    format: "html",
    template: row.template == null ? null : String(row.template),
  }, { onError: (message) => error = message }).catch((e) => (error = String(e?.message ?? e), 0));
  return sent
    ? html.async`<u2-alert open variant=success>${t`Test sent to ${address}.`}</u2-alert>`
    : html.async`<u2-alert open variant=error>${t`Test not sent.`} ${error}</u2-alert>`;
}

async function editor(node: Node, row: Row, notice: unknown) {
  const app = node.app, t = app.t, db = app.db, ctx = getCtx();
  const [lists, frames, me, to] = await Promise.all([
    listRows(app),
    db.col<string>`SELECT name FROM message_template WHERE channel = ${CHANNEL} ORDER BY name`,
    db.one<string>`SELECT c.address FROM usr_contact c WHERE c.usr_id = ${ctx.userId ?? 0} AND c.type = ${CHANNEL} AND ${MAIN}`,
    here(node),
  ]);
  const members = row.reachable;
  const selected = (on: boolean) => on ? html.raw(" selected") : "";

  return html.async`<div class=u2-flex style="flex-basis:100%">
  <div class=u2-card style="flex:0 1 53rem">
    <div class=-head>${t`Newsletter`} <span class=u2-badge>${t`Draft`}</span> <a href="${to()}" class=-back>${t`Back`}</a></div>
    <form method=post data-issue="${row.id}">
      ${csrf(ctx)}
      ${notice}
      <u2-fields>
        ${t`List`} <select name=grp>${lists.map((l) => html`<option value="${l.id}"${selected(Number(l.id) === Number(row.grp_id))}>${l.name}</option>`)}</select>
        ${t`Subject`} <input name=title value="${row.title}" maxlength=191 placeholder="${t`What the mail is about`}">
        ${t`Template`} <select name=template>
          ${frames.map((f) => html`<option value="${f}"${selected(f === row.template)}>${f}</option>`)}
          <option value=""${selected(row.template == null)}>${t`none`}</option>
        </select>
      </u2-fields>
      <u2-rte class=-editor><textarea name=text>${row.text}</textarea></u2-rte>
      <div class=-actions>
        <button name=save>${t`Save`}</button>
        <button name=delete formnovalidate u2-confirm="${t`Really delete this draft?`}">${t`Delete`}</button>
      </div>
      <fieldset class=-actions>
        <legend>${t`Test`}</legend>
        <input type=email name=address value="${me ?? ""}" placeholder="name@example.com" aria-label="${t`Address`}">
        <button name=test>${t`Send test`}</button>
      </fieldset>
      <fieldset class=-actions>
        <legend>${t`Send to the list`} (${Number(members)})</legend>
        <button name=send u2-confirm="${t`Send this newsletter to ${Number(members)} subscribers now?`}">${t`Send now`}</button>
        <input type=datetime-local name=when aria-label="${t`When`}">
        <input type=hidden name=at>
        <button name=schedule>${t`Schedule`}</button>
      </fieldset>
    </form>
  </div>
  ${previewCard(app, row)}
</div>`;
}

/** The issue in its template, as a subscriber sees it; placeholders show their fallback. */
export async function preview(app: App, msg: { text?: unknown; template?: unknown }): Promise<string> {
  const frame = msg.template ? await template(app, CHANNEL, String(msg.template)) : undefined;
  const text = String(msg.text ?? "");
  // the values a mail gets, without a recipient: the site's identity fills in, givenName shows its fallback
  const made = modulePlaceholders<Row>(app, "messaging");
  const values = Object.fromEntries(await Promise.all([...placeholderNames(text, frame?.text)].filter((name) => made[name])
    .map(async (name) => [name, await made[name](app, {}).catch(() => undefined) ?? { text: "" }] as const)));
  // a recipient's own link would unsubscribe them: the preview shows where it stands, leading nowhere
  const label = await app.t`Unsubscribe`;
  values.unsubscribe = { text: label, html: html.raw(`<a href="#">${hee(label)}</a>`) };
  return templated(frame, { text, format: "html" })(values).html ?? "";
}

async function previewCard(app: App, row: Row) {
  return html.async`<div class=u2-card style="flex:1 1 28rem">
    <div class=-head>${app.t`Preview`}</div>
    <iframe sandbox srcdoc="${await preview(app, row)}" class="-frame -body" title="${app.t`Preview`}"></iframe>
  </div>`;
}

/** What came of a sent or scheduled issue. */
async function report(node: Node, row: Row) {
  const app = node.app, t = app.t, db = app.db, ctx = getCtx();
  const id = Number(row.id);
  const [deliveries, links, to] = await Promise.all([
    db.query`
      SELECT d.address, d.sent, d.due, d.error, u.given_name, u.family_name,
        (SELECT MIN(t.time) FROM message_track t WHERE t.delivery_id = d.id) AS opened,
        (SELECT COUNT(*) FROM message_track t WHERE t.delivery_id = d.id AND t.kind = ${"click"}) AS clicks,
        (SELECT COUNT(*) FROM message_track t WHERE t.delivery_id = d.id AND t.code = ${unsubscribeCode}) AS unsubscribed
      FROM message_delivery d LEFT JOIN usr u ON u.id = d.usr_id
      WHERE d.message_id = ${id} ORDER BY d.address`,
    db.query`
      SELECT t.code, COUNT(*) AS clicks, COUNT(DISTINCT t.delivery_id) AS people
      FROM message_track t JOIN message_delivery d ON d.id = t.delivery_id
      WHERE d.message_id = ${id} AND t.kind = ${"click"}
      GROUP BY t.code ORDER BY clicks DESC`,
    here(node),
  ]);
  // shorturl knows what a code stands for; without it the code stands for itself
  const codes = links.map((l) => l.code).filter((code) => code !== unsubscribeCode); // that one is ours, not short
  const urls = new Map(codes.length
    ? (await db.query`SELECT code, url FROM shorturl WHERE ${sql.in("code", codes)}`.catch(() => [])).map((l) => [l.code, l.url])
    : []);
  const scheduled = Number(row.pending) && !Number(row.reached);
  const stat = (label: Promise<string>, value: unknown, note: unknown = "") =>
    html.async`<div><b>${value}</b> ${label} ${note}</div>`;

  return html.async`<div class=u2-flex style="flex-basis:100%">
  <div class=u2-card style="flex:1 1 32rem">
    <div class=-head>${str(row.title) || t`(no subject)`} ${status(app, row)} <a href="${to()}" class=-back>${t`Back`}</a></div>
    ${app.modules.linked("shorturl") ? "" : html.async`<u2-alert open variant=info>${t`Opens and clicks are only counted with the module shorturl.`}</u2-alert>`}
    <div class=-stats>
      ${stat(t`recipients`, Number(row.recipients))}
      ${stat(t`reached`, Number(row.reached))}
      ${stat(t`opened`, Number(row.opened), percent(row.opened, row.reached))}
      ${stat(t`clicked`, Number(row.clicked), percent(row.clicked, row.reached))}
      ${stat(t`unsubscribed`, Number(row.unsubscribed), percent(row.unsubscribed, row.reached))}
      ${Number(row.failed) ? stat(t`failed`, Number(row.failed)) : ""}
      ${Number(row.pending) ? stat(t`pending`, Number(row.pending)) : ""}
    </div>
    <form method=post class=-actions>
      ${csrf(ctx)}
      <button name=duplicate>${t`Duplicate as draft`}</button>
      ${scheduled ? html.async`<button name=cancel u2-confirm="${t`Stop the schedule and make it a draft again?`}">${t`Cancel schedule`}</button>` : ""}
    </form>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Address`}
        <th>${t`Name`}
        <th>${t`Opened`}
        <th>${t`Clicks`}
        <th>${t`Result`}
      <tbody>${deliveries.map((d) => html.async`<tr>
        <td>${d.address}
        <td>${[d.given_name, d.family_name].filter(Boolean).join(" ")}
        <td>${d.opened ? u2.el.time(d.opened, { narrow: true }) : ""}
        <td>${Number(d.clicks) || ""}
        <td>${d.error
          // the kind in a few words; what the server said stays on the delivery, shown on hover
          ? html.async`<span class=u2-badge style="--color-dark:var(--red)" title="${d.error}">${failureText(app, String(d.error))}</span>`
          : Number(d.unsubscribed) ? html.async`<span class=u2-badge>${t`unsubscribed`}</span>`
          : d.sent ? "✓" : html.async`${t`due`} ${u2.el.time(d.due)}`}`)}
    </table>
  </div>
  <div class=u2-flex style="flex:1 1 28rem; flex-direction:column">
    <div class=u2-card>
      <div class=-head>${t`Links`}</div>
      <table class=u2-table>
        <thead><tr>
          <th>${t`Link`}
          <th>${t`Clicks`}
          <th>${t`People`}
        <tbody>${links.length ? links.map((l) => html.async`<tr>
          <td>${l.code === unsubscribeCode ? t`Unsubscribe`
            : urls.has(l.code) ? html`<a href="${urls.get(l.code)}" target=_blank rel=noreferrer>${urls.get(l.code)}</a>` : l.code}
          <td>${Number(l.clicks)}
          <td>${Number(l.people)}`) : html.async`<tr><td colspan=3>${t`No clicks yet.`}`}
      </table>
    </div>
    ${previewCard(app, row)}
  </div>
</div>`;
}

// --- list -----------------------------------------------------------------------------------

async function listView(node: Node, id: number) {
  const app = node.app, t = app.t, db = app.db, ctx = getCtx(), to = await here(node);
  const list = await db.row`SELECT id, name FROM grp WHERE id = ${id} AND type = ${TYPE}`;
  if (!list) return html.async`<div class=u2-card><div>${t`List not found.`}</div></div>`;
  const query = ctx.req.query;
  if (query.export) exportCsv(String(list.name), await members(app, id, "", 0));

  const post = posted(ctx);
  let notice: unknown = "";
  if (post) {
    if ("rename" in post && str(post.name)) await db.table("grp").update(id, { name: str(post.name) });
    if ("remove" in post) await db.table("usr_grp").delete({ usr_id: Number(post.remove), grp_id: id });
    if ("purge" in post) {
      await db.exec`DELETE FROM usr_grp WHERE grp_id = ${id} AND usr_id IN (
        SELECT c.usr_id FROM usr_contact c WHERE c.type = ${CHANNEL} AND c.error IS NOT NULL AND ${MAIN})`;
    }
    if ("deleteList" in post && !await db.one`SELECT id FROM message WHERE grp_id = ${id} LIMIT 1`) {
      await db.transaction(async () => {
        await db.exec`DELETE FROM usr_grp WHERE grp_id = ${id}`;
        await db.exec`DELETE FROM grp WHERE id = ${id}`;
      });
      return redirect(to());
    }
    if ("add" in post) notice = imported(app, await subscribe(app, id, String(post.addresses ?? "")));
    if ("rename" in post || "remove" in post || "purge" in post) return redirect(to({ list: id }));
  }

  const search = str(query.q);
  const [rows, used, [counts]] = await Promise.all([
    members(app, id, search),
    db.one`SELECT id FROM message WHERE grp_id = ${id} LIMIT 1`,
    listRows(app, id),
  ]);
  const bounced = Number(counts?.bounced);

  return html.async`<div class=u2-flex style="flex-basis:100%">
  <div class=u2-card style="flex:1 1 40rem">
    <div class=-head>${list.name} <span class=u2-badge>${Number(counts?.members)}</span> <a href="${to()}" class=-back>${t`Back`}</a></div>
    <div class=-actions>
      <form method=get action="${to()}" class=-inline>
        <input type=hidden name=list value="${id}">
        <input type=search name=q value="${search}" placeholder="${t`Search...`}">
      </form>
      <a href="${to({ list: id, export: 1 })}" download>${t`Export CSV`}</a>
      ${bounced ? html.async`<form method=post class=-inline>${csrf(ctx)}
        <button name=purge u2-confirm="${t`Remove ${bounced} bounced addresses from this list?`}">${t`Remove bounced`} (${bounced})</button>
      </form>` : ""}
    </div>
    <form method=post style="padding:0">
      ${csrf(ctx)}
      <table class=u2-table>
        <thead><tr>
          <th>${t`Address`}
          <th>${t`Name`}
          <th>${t`Status`}
          <th>
        <tbody>${rows.length ? rows.map((row) => html.async`<tr>
          <td>${row.address ?? html.async`<i>${t`no address`}</i>`}
          <td>${[row.given_name, row.family_name].filter(Boolean).join(" ")}
          <td>${row.error ? html.async`<span class=u2-badge style="--color-dark:var(--red)" title="${row.error}">${t`bounced`}</span>` : ""}
          <td><button class=u2-unstyle name=remove value="${row.id}" title="${t`Remove from list`}" u2-confirm="${t`Remove ${row.address} from this list?`}"><u2-ico icon=delete>×</u2-ico></button>`)
          : html.async`<tr><td colspan=4>${search ? t`Nobody found.` : t`No subscribers yet.`}`}
      </table>
    </form>
  </div>
  <div class=u2-flex style="flex:0 1 24rem; flex-direction:column">
    <div class=u2-card>
      <div class=-head>${t`Add subscribers`}</div>
      <form method=post>
        ${csrf(ctx)}
        ${notice}
        <textarea name=addresses rows=8 required placeholder="ada@example.com&#10;Ada Lovelace &lt;ada@example.com&gt;"></textarea>
        <p><small>${t`One address per line, optionally with a name. Addresses this site already knows are not added: someone who unsubscribed stays out.`}</small></p>
        <button name=add>${t`Add`}</button>
      </form>
    </div>
    <div class=u2-card>
      <div class=-head>${t`List`}</div>
      <form method=post class=-actions>
        ${csrf(ctx)}
        <input name=name value="${list.name}" required aria-label="${t`Name`}">
        <button name=rename>${t`Rename`}</button>
        ${used ? "" : html.async`<button name=deleteList formnovalidate u2-confirm="${t`Delete this list? Its subscribers stay users of the site.`}">${t`Delete`}</button>`}
      </form>
    </div>
  </div>
</div>`;
}

/** The list's members with the address they receive on; `search` matches address and name,
 *  `limit` 0 is all. */
function members(app: App, id: number, search = "", limit = LIMIT) {
  const { where, order } = sqlSearch(search, ["c.address", "u.given_name", "u.family_name"], { exact: ["c.address"] });
  return app.db.query`
    SELECT u.id, u.given_name, u.family_name, c.address, c.error
    FROM usr_grp ug JOIN usr u ON u.id = ug.usr_id
    LEFT JOIN usr_contact c ON c.usr_id = u.id AND c.type = ${CHANNEL} AND ${MAIN}
    WHERE ug.grp_id = ${id} AND ${where}
    ORDER BY ${order}, c.address ${limit ? sql`LIMIT ${limit}` : sql``}`;
}

/**
 * Add addresses to the list. Only addresses unknown to the site get a user — inactive, without
 * password. Known ones are left alone: an import must not undo an unsubscribe.
 */
export async function subscribe(app: App, grpId: number, input: string): Promise<{ added: number; known: string[]; invalid: string[] }> {
  const db = app.db;
  const result = { added: 0, known: [] as string[], invalid: [] as string[] };
  for (const line of input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    let address = "";
    try {
      address = contactKey("email", line);
    } catch {
      result.invalid.push(line);
      continue;
    }
    if (await contactOwner(db, "email", address)) {
      result.known.push(address);
      continue;
    }
    const [given, ...rest] = (line.match(/^\s*"?([^"<]*?)"?\s*</)?.[1] ?? "").split(/\s+/).filter(Boolean);
    await db.transaction(async () => {
      const usrId = Number(await db.table("usr").insert({
        active: false,
        pw: "",
        given_name: given ?? null,
        family_name: rest.join(" ") || null,
      }));
      await addContact(db, usrId, "email", address);
      await db.table("usr_grp").ensure({ usr_id: usrId, grp_id: grpId });
    });
    result.added++;
  }
  return result;
}

function imported(app: App, { added, known, invalid }: Awaited<ReturnType<typeof subscribe>>) {
  const t = app.t;
  return html.async`<u2-alert open variant=${invalid.length || known.length ? "warning" : "success"}>
    ${t`${added} added.`}
    ${known.length ? html.async`<br>${t`Already known, not added:`} ${known.join(", ")}` : ""}
    ${invalid.length ? html.async`<br>${t`Not an address:`} ${invalid.join(", ")}` : ""}
  </u2-alert>`;
}

/** The members as CSV, ends the request. */
function exportCsv(name: string, rows: Row[]): never {
  const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [["email", "given_name", "family_name", "error"], ...rows.map((r) => [r.address, r.given_name, r.family_name, r.error])];
  throw new Output(lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}.csv"`,
    },
  });
}

function redirect(to: string) {
  const ctx = getCtx();
  ctx.res.status = 303;
  ctx.res.headers.set("Location", to);
  return "";
}
