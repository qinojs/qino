import type { Node } from "../cms/mod.ts";
import { html, type HtmlString, type Row } from "../core/mod.ts";
import { u2 } from "../cms.backend/mod.ts";
import { vapid } from "../messaging.web_push/mod.ts";

/** Configuration plus the three live regions the client script re-renders. */
export async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const { subject, publicKey } = await vapid(node.app);
  return html.async`<div>
  <div class=u2-card>
    <div class=-head>${t`VAPID`}</div>
    <div class=-body>
      <u2-fields>
        ${t`Contact`} <input name=subject value="${subject}" readonly>
        ${t`Public key`} <input name=publicKey value="${publicKey}" readonly>
      </u2-fields>
      <small>${t`Generated on first use. The contact is a setting of messaging.web_push.`}</small>
    </div>
  </div>

  <div class=u2-card cms-part=channels>${channels(node)}</div>

  <div class=u2-card cms-part=send>${send(node)}</div>

  <div class=u2-card cms-part=subscriptions>${subscriptions(node)}</div>
</div>`;
}

export async function channels(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const rows = await node.app.db.query`
    SELECT c.id, c.name, (SELECT COUNT(*) FROM web_push_subscription_channel sc WHERE sc.channel_id = c.id) AS subs
    FROM web_push_channel c
    ORDER BY c.name`;
  const del = await t`Delete this channel and all its subscriptions?`;
  const body = rows.length
    ? html.join(rows.map((c) => html`<tr>
      <td>${c.name}
      <td>${c.subs}
      <td><button type=button class=u2-unstyle data-channel-delete="${c.id}"
        u2-confirm="${del}"><u2-ico icon=delete>✕</u2-ico></button>`))
    : html`<tr><td colspan=3>${await t`No channels yet.`}`;

  return html.async`<div class=-head>${t`Channels`} (${rows.length})</div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`Name`}
      <th>${t`Subscriptions`}
      <th>
    <tbody>${body}
  </table>
  <form class=-body>
    <u2-fields>
      ${t`New channel`} <input name=channel required>
    </u2-fields>
    <div><button type=button data-channel-add>${t`Add`}</button></div>
  </form>`;
}

/** Only channels, groups and users that can actually be reached are offered. */
export async function send(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const db = node.app.db;
  const channelRows = await db.query`
    SELECT c.name, (SELECT COUNT(*) FROM web_push_subscription_channel sc WHERE sc.channel_id = c.id) AS subs
    FROM web_push_channel c
    ORDER BY c.name`;
  const groupRows = await db.query`
    SELECT g.id, g.name, COUNT(*) AS subs
    FROM web_push_subscription s
    JOIN usr_grp ug ON ug.usr_id = s.usr_id
    JOIN grp g ON g.id = ug.grp_id
    GROUP BY g.id, g.name
    ORDER BY g.name`;
  const userRows = await db.query`
    SELECT s.usr_id, u.email, COUNT(*) AS subs
    FROM web_push_subscription s
    LEFT JOIN usr u ON u.id = s.usr_id
    WHERE s.usr_id IS NOT NULL
    GROUP BY s.usr_id, u.email
    ORDER BY u.email`;
  const channelOptions = html.join(channelRows.map((c) => html`<option value="channel:${c.name}">${c.name} (${c.subs})</option>`));
  const groupOptions = html.join(groupRows.map((g) => html`<option value="grp:${g.id}">${g.name} (${g.subs})</option>`));
  const userOptions = html.join(userRows.map((u) => html`<option value="usr:${u.usr_id}">${u.email ?? "#" + u.usr_id} (${u.subs})</option>`));

  return html.async`<div class=-head>${t`Send notification`}</div>
  <form class=-body>
    <u2-fields>
      ${t`To`} <select name=to>
        <option value=all>${t`All subscribers`}</option>
        <optgroup label="${await t`Channels`}">${channelOptions}</optgroup>
        <optgroup label="${await t`Groups`}">${groupOptions}</optgroup>
        <optgroup label="${await t`Users`}">${userOptions}</optgroup>
      </select>
      ${t`Title`} <input name=title required>
      ${t`Text`} <input name=body>
      ${t`Link`} <input name=url placeholder="/">
    </u2-fields>
    <div><button type=button data-send>${t`Send`}</button></div>
  </form>`;
}

export async function subscriptions(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const db = node.app.db;
  const rows = await db.query`
    SELECT s.*, u.email
    FROM web_push_subscription s
    LEFT JOIN usr u ON u.id = s.usr_id
    ORDER BY s.created DESC LIMIT 500`;
  // grouped here rather than in SQL — GROUP_CONCAT/STRING_AGG differ per dialect
  const memberships = new Map<number, string[]>();
  for (const m of await db.query`
    SELECT sc.sub_id, c.name FROM web_push_subscription_channel sc
    JOIN web_push_channel c ON c.id = sc.channel_id
    ORDER BY c.name`) {
    memberships.set(Number(m.sub_id), [...memberships.get(Number(m.sub_id)) ?? [], String(m.name)]);
  }
  // translated once, not per row — parallel t() of the same new string collides in smalltext
  const labels = { anonymous: await t`anonymous`, test: await t`Send a test notification`, del: await t`Delete this subscription?` };
  const body = rows.length
    ? html.join(rows.map((r) => subscription(r, memberships.get(Number(r.id)) ?? [], labels)))
    : html`<tr><td colspan=6>${await t`Nobody has subscribed yet.`}`;

  return html.async`<div class=-head>${t`Subscriptions`} (${rows.length})</div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`User`}
      <th>${t`Client`}
      <th>${t`Channels`}
      <th>${t`Push service`}
      <th>${t`Since`}
      <th>
    <tbody>${body}
  </table>`;
}

function subscription(s: Row, channels: string[], labels: Record<string, string>): HtmlString {
  const host = String(s.endpoint).split("/")[2] ?? "?";
  return html`<tr>
    <td>${s.email ?? (s.usr_id ? "#" + s.usr_id : labels.anonymous)}
    <td>${s.client_id ?? "-"}
    <td>${channels.join(", ") || "-"}
    <td title="${s.endpoint}">${host}
    <td>${u2.time(s.created)}
    <td>
      <button type=button class=u2-unstyle data-test="${s.id}" title="${labels.test}"><u2-ico icon=send>➤</u2-ico></button>
      <button type=button class=u2-unstyle data-delete="${s.id}"
        u2-confirm="${labels.del}"><u2-ico icon=delete>✕</u2-ico></button>`;
}
