import { addContact, contactKey, contactOwner, getCtx, html, Output, safeEqual, sql, sqlSearch, unixTime } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { record, release, templated } from "@qino/qino/messaging";
import { send } from "@qino/qino/messaging.email";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString, Row, Sql } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// A list is a group of type newsletter, an issue is a mail to it: a draft until it has deliveries.

const { name: NS } = manifest;
export const TYPE = "newsletter";
const CHANNEL = "email";
const LIMIT = 500;

/** The address a member receives on: the main one, else the oldest — as messaging picks it. */
const MAIN = sql`c.address = (SELECT o.address FROM usr_contact o
  WHERE o.type = ${CHANNEL} AND o.usr_id = c.usr_id ORDER BY o.main DESC, o.created, o.address LIMIT 1)`;

export function render(node: Node): Promise<HtmlString | string> {
  const query = getCtx().req.query;
  const issue = idOf(query.issue), list = idOf(query.list);
  return node.app.t.with(NS, () => issue ? issueView(node, issue) : list ? listView(node, list) : overview(node));
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
  const app = node.app, t = app.t, ctx = getCtx();
  const post = posted(ctx);
  if (post && "createList" in post && str(post.name)) {
    return redirect(`?list=${await app.db.table("grp").insert({ name: str(post.name), type: TYPE })}`);
  }
  if (post && "createIssue" in post && await isList(app, Number(post.grp))) {
    return redirect(`?issue=${await draft(app, Number(post.grp))}`);
  }
  const [lists, issues] = await Promise.all([listRows(app), issueRows(app)]);

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1 1 45rem">
    <div class=-head>${t`Issues`}</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Subject`}
        <th>${t`List`}
        <th>${t`Status`}
        <th>${t`Recipients`}
        <th>${t`Opened`}
        <th>${t`Clicked`}
      <tbody>${issues.length ? issues.map((row) => html.async`<tr u2-href>
        <td><a href="?issue=${row.id}">${str(row.title) || t`(no subject)`}</a>
        <td>${row.list}
        <td>${status(app, row)}
        <td>${Number(row.recipients) || ""}
        <td>${share(row.opened, row.reached)}
        <td>${share(row.clicked, row.reached)}`) : html.async`<tr><td colspan=6>${t`No issues yet.`}`}
    </table>
    ${lists.length ? html.async`<form method=post class="-body -inline">
      ${csrf(ctx)}
      <select name=grp aria-label="${t`List`}">${lists.map((l) => html`<option value="${l.id}">${l.name}</option>`)}</select>
      <button name=createIssue>${t`New issue`}</button>
    </form>` : ""}
  </div>
  <div class=u2-card style="flex:0 1 22rem">
    <div class=-head>${t`Lists`}</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Name`}
        <th>${t`Subscribers`}
        <th>${t`Bounced`}
      <tbody>${lists.length ? lists.map((row) => html`<tr u2-href>
        <td><a href="?list=${row.id}">${row.name}</a>
        <td>${Number(row.members)}
        <td>${Number(row.bounced) || ""}`) : html.async`<tr><td colspan=3>${t`No lists yet.`}`}
    </table>
    <form method=post class="-body -inline">
      ${csrf(ctx)}
      <input name=name required placeholder="${t`Name of the new list`}">
      <button name=createList>${t`Create`}</button>
    </form>
  </div>
</div>`;
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
      ${of(sql`${true}`)} AS recipients,
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
      COUNT(DISTINCT CASE WHEN t.kind = ${"click"} THEN t.delivery_id END) AS clicked
    FROM message_delivery d JOIN message_track t ON t.delivery_id = d.id
    WHERE ${sql.in("d.message_id", rows.map((row) => row.id))}
    GROUP BY d.message_id`).map((row) => [Number(row.message_id), row]));
  for (const row of rows) {
    const hit = hits.get(Number(row.id));
    row.opened = hit?.opened ?? 0;
    row.clicked = hit?.clicked ?? 0;
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

/** A new draft to the list, wrapped in the newsletter template if there is one, else the main one. */
async function draft(app: App, grpId: number, from?: Row) {
  const template = from ? from.template : await app.db.one<string>`SELECT name FROM message_template
    WHERE channel = ${CHANNEL} AND (name = ${TYPE} OR main = ${true})
    ORDER BY CASE WHEN name = ${TYPE} THEN 0 ELSE 1 END LIMIT 1`;
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
  const app = node.app, t = app.t, ctx = getCtx();
  let [row] = await issueRows(app, id);
  if (!row) return html.async`<div class=u2-card><div class=-body>${t`Issue not found.`}</div></div>`;
  const post = posted(ctx);
  const isDraft = !Number(row.recipients);
  let notice: unknown = "";

  if (post && isDraft) {
    if ("delete" in post) {
      await app.db.exec`DELETE FROM message WHERE id = ${id}`;
      return redirect("?");
    }
    await save(app, id, post);
    if ("save" in post) return redirect(`?issue=${id}`);
    [row] = await issueRows(app, id);
    if ("test" in post) notice = await test(app, row, str(post.address));
    if ("send" in post || "schedule" in post) {
      const at = "schedule" in post ? Number(post.at) : unixTime();
      if (!(at > 0)) notice = html.async`<u2-alert open variant=warning>${t`Choose when to send it.`}</u2-alert>`;
      else if (!str(row.title)) notice = html.async`<u2-alert open variant=warning>${t`The issue needs a subject.`}</u2-alert>`;
      else {
        await release(app, id, at);
        [row] = await issueRows(app, id);
        if (!Number(row.recipients)) notice = html.async`<u2-alert open variant=warning>${t`Nobody on this list has an address.`}</u2-alert>`;
        else return redirect(`?issue=${id}`);
      }
    }
  }
  if (post && !isDraft) {
    if ("duplicate" in post) return redirect(`?issue=${await draft(app, Number(row.grp_id), row)}`);
    // only while nothing went out: the deliveries go, the message is a draft again
    if ("cancel" in post && !Number(row.reached)) {
      await app.db.exec`DELETE FROM message_delivery WHERE message_id = ${id}`;
      return redirect(`?issue=${id}`);
    }
  }
  return Number(row.recipients) ? report(node, row) : editor(node, row, notice);
}

/** Store the editor's fields; the list only changes to another list. */
async function save(app: App, id: number, post: Record<string, unknown>) {
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
  const [lists, frames, me, members] = await Promise.all([
    listRows(app),
    db.col<string>`SELECT name FROM message_template WHERE channel = ${CHANNEL} ORDER BY name`,
    db.one<string>`SELECT c.address FROM usr_contact c WHERE c.usr_id = ${ctx.userId ?? 0} AND c.type = ${CHANNEL} AND ${MAIN}`,
    db.one`SELECT COUNT(*) FROM usr_grp ug JOIN usr_contact c ON c.usr_id = ug.usr_id AND c.type = ${CHANNEL} AND ${MAIN}
      WHERE ug.grp_id = ${row.grp_id}`,
  ]);
  const selected = (on: boolean) => on ? html.raw(" selected") : "";

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1 1 32rem">
    <div class=-head>${t`Issue`} <span class=u2-badge>${t`Draft`}</span> <a href="?" class=-back>${t`Back`}</a></div>
    <form method=post class=-body data-issue>
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
        <button name=send u2-confirm="${t`Send this issue to ${Number(members)} subscribers now?`}">${t`Send now`}</button>
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
  const frame = msg.template == null || msg.template === ""
    ? undefined
    : await app.db.row`SELECT text, format FROM message_template WHERE name = ${String(msg.template)} AND channel = ${CHANNEL}`;
  const template = frame ? { text: String(frame.text ?? ""), format: (frame.format || undefined) as "md" | "html" | undefined } : undefined;
  return templated(template, { text: String(msg.text ?? ""), format: "html" })().html ?? "";
}

async function previewCard(app: App, row: Row) {
  return html.async`<div class=u2-card style="flex:1 1 28rem">
    <div class=-head>${app.t`Preview`}</div>
    <iframe sandbox srcdoc="${await preview(app, row)}" class=-frame title="${app.t`Preview`}"></iframe>
  </div>`;
}

/** What came of a sent or scheduled issue. */
async function report(node: Node, row: Row) {
  const app = node.app, t = app.t, db = app.db, ctx = getCtx();
  const id = Number(row.id);
  const [deliveries, links] = await Promise.all([
    db.query`
      SELECT d.address, d.sent, d.due, d.error, u.given_name, u.family_name,
        (SELECT MIN(t.time) FROM message_track t WHERE t.delivery_id = d.id) AS opened,
        (SELECT COUNT(*) FROM message_track t WHERE t.delivery_id = d.id AND t.kind = ${"click"}) AS clicks
      FROM message_delivery d LEFT JOIN usr u ON u.id = d.usr_id
      WHERE d.message_id = ${id} ORDER BY d.address`,
    db.query`
      SELECT t.code, COUNT(*) AS clicks, COUNT(DISTINCT t.delivery_id) AS people
      FROM message_track t JOIN message_delivery d ON d.id = t.delivery_id
      WHERE d.message_id = ${id} AND t.kind = ${"click"}
      GROUP BY t.code ORDER BY clicks DESC`,
  ]);
  // shorturl knows what a code stands for; without it the code stands for itself
  const urls = new Map(links.length
    ? (await db.query`SELECT code, url FROM shorturl WHERE ${sql.in("code", links.map((l) => l.code))}`.catch(() => [])).map((l) => [l.code, l.url])
    : []);
  const scheduled = Number(row.pending) && !Number(row.reached);
  const stat = (label: Promise<string>, value: unknown, note: unknown = "") =>
    html.async`<div><b>${value}</b> ${label} ${note}</div>`;

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1 1 32rem">
    <div class=-head>${str(row.title) || t`(no subject)`} ${status(app, row)} <a href="?" class=-back>${t`Back`}</a></div>
    <div class="-body -stats">
      ${stat(t`recipients`, Number(row.recipients))}
      ${stat(t`reached`, Number(row.reached))}
      ${stat(t`opened`, Number(row.opened), percent(row.opened, row.reached))}
      ${stat(t`clicked`, Number(row.clicked), percent(row.clicked, row.reached))}
      ${Number(row.failed) ? stat(t`failed`, Number(row.failed)) : ""}
      ${Number(row.pending) ? stat(t`pending`, Number(row.pending)) : ""}
    </div>
    <form method=post class="-body -actions">
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
          ? html`<span class=u2-badge style="--color-dark:var(--red)" title="${d.error}">${d.error}</span>`
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
        <tbody>${links.length ? links.map((l) => html`<tr>
          <td>${urls.has(l.code) ? html`<a href="${urls.get(l.code)}" target=_blank rel=noreferrer>${urls.get(l.code)}</a>` : l.code}
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
  const app = node.app, t = app.t, db = app.db, ctx = getCtx();
  const list = await db.row`SELECT id, name FROM grp WHERE id = ${id} AND type = ${TYPE}`;
  if (!list) return html.async`<div class=u2-card><div class=-body>${t`List not found.`}</div></div>`;
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
      return redirect("?");
    }
    if ("add" in post) notice = imported(app, await subscribe(app, id, String(post.addresses ?? "")));
    if ("rename" in post || "remove" in post || "purge" in post) return redirect(`?list=${id}`);
  }

  const search = str(query.q);
  const [rows, used, [counts]] = await Promise.all([
    members(app, id, search),
    db.one`SELECT id FROM message WHERE grp_id = ${id} LIMIT 1`,
    listRows(app, id),
  ]);
  const bounced = Number(counts?.bounced);

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1 1 40rem">
    <div class=-head>${list.name} <span class=u2-badge>${Number(counts?.members)}</span> <a href="?" class=-back>${t`Back`}</a></div>
    <div class="-body -actions">
      <form method=get class=-inline>
        <input type=hidden name=list value="${id}">
        <input type=search name=q value="${search}" placeholder="${t`Search...`}">
      </form>
      <a href="?list=${id}&amp;export=1" download>${t`Export CSV`}</a>
      ${bounced ? html.async`<form method=post class=-inline>${csrf(ctx)}
        <button name=purge u2-confirm="${t`Remove ${bounced} bounced addresses from this list?`}">${t`Remove bounced`} (${bounced})</button>
      </form>` : ""}
    </div>
    <form method=post>
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
      <form method=post class=-body>
        ${csrf(ctx)}
        ${notice}
        <textarea name=addresses rows=8 required placeholder="ada@example.com&#10;Ada Lovelace &lt;ada@example.com&gt;"></textarea>
        <p><small>${t`One address per line, optionally with a name. Addresses this site already knows are not added: someone who unsubscribed stays out.`}</small></p>
        <button name=add>${t`Add`}</button>
      </form>
    </div>
    <div class=u2-card>
      <div class=-head>${t`List`}</div>
      <form method=post class="-body -actions">
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
