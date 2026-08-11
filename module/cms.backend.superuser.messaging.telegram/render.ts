import type { Node } from "../cms/mod.ts";
import { getCtx, html, type HtmlString, type Row } from "../core/mod.ts";
import { u2 } from "../cms.backend/mod.ts";
import { bot as botInfo, chats as chatList, webhookInfo } from "../messaging.telegram/mod.ts";

/** Where Telegram has to deliver its updates for this app. */
export const webhookUrl = (): string => {
  const req = getCtx().req;
  return req.url.origin + req.appUrl + "telegram/webhook";
};

export function render(node: Node): Promise<HtmlString> {
  return html.async`<div class=u2-flex>
  <div class=u2-card cms-part=bot>${bot(node)}</div>
  <div class=u2-card cms-part=send>${send(node)}</div>
  <div class=u2-card cms-part=chats>${chats(node)}</div>
</div>`;
}

/** Bot identity and webhook state — both are live answers from Telegram. */
export async function bot(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const configured = Boolean(await node.app.settings["messaging.telegram"].botToken);
  const token = configured ? "" : html.async`<form>
    <u2-fields>
      ${t`Bot token`} <input type=password name=botToken autocomplete=off
        placeholder="123456:…" required>
    </u2-fields>
    <button type=button data-token-save>${t`Save token`}</button>
  </form>`;
  const state = await Promise.all([botInfo(node.app), webhookInfo(node.app)]).catch((e: Error) => e.message);
  if (typeof state === "string") {
    return html.async`<div class=-head>${t`Bot`}</div>
    <div class=-body>
      ${token}
      <p>${state}</p>
      ${configured ? "" : html`<small>${await t`Create a bot with @BotFather and enter its token above.`}</small>`}
    </div>`;
  }

  const [me, hook] = state;
  const url = webhookUrl();
  const registered = hook.url === url;
  const status = await (registered ? t`registered` : hook.url ? t`registered elsewhere` : t`not registered`);
  const [pending, remove] = await Promise.all([t`pending`, t`Remove`]);
  return html.async`<div class=-head>${t`Bot`}</div>
  <div class=-body>
    ${token}
    <u2-fields>
      ${t`Bot`} <input value="@${me.username}" readonly>
      ${t`Webhook`} <input value="${url}" readonly>
    </u2-fields>
    <p><span class=u2-badge>${status}</span> ${registered ? "" : hook.url ?? ""}
      ${hook.pending_update_count ? html` · ${hook.pending_update_count} ${pending}` : ""}
      ${hook.last_error_message ? html`<br><small>${hook.last_error_message}</small>` : ""}
    </p>
    <div>
      <button type=button data-webhook-set>${registered ? t`Register again` : t`Register webhook`}</button>
      ${hook.url ? html`<button type=button data-webhook-delete>${remove}</button>` : ""}
    </div>
    <small>${t`Telegram only delivers to a public HTTPS address — registering from a local installation fails.`}</small>
  </div>`;
}

/** Only groups and users that can actually be reached are offered. */
export async function send(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const db = node.app.db;
  const [groupRows, userRows] = await Promise.all([
    db.query`
      SELECT g.id, g.name, COUNT(*) AS chats
      FROM telegram_chat c
      JOIN usr_grp ug ON ug.usr_id = c.usr_id
      JOIN grp g ON g.id = ug.grp_id
      GROUP BY g.id, g.name
      ORDER BY g.name`,
    db.query`
      SELECT c.usr_id, u.email, COUNT(*) AS chats
      FROM telegram_chat c
      LEFT JOIN usr u ON u.id = c.usr_id
      GROUP BY c.usr_id, u.email
      ORDER BY u.email`,
  ]);
  const groupOptions = groupRows.map((g) => html`<option value="grp:${g.id}">${g.name} (${g.chats})</option>`);
  const userOptions = userRows.map((u) => html`<option value="usr:${u.usr_id}">${u.email ?? "#" + u.usr_id} (${u.chats})</option>`);

  return html.async`<div class=-head>${t`Send message`}</div>
  <form class=-body>
    <u2-fields>
      ${t`To`} <select name=to>
        <option value=all>${t`Everyone linked`}</option>
        <optgroup label="${await t`Groups`}">${groupOptions}</optgroup>
        <optgroup label="${await t`Users`}">${userOptions}</optgroup>
      </select>
      ${t`Text`} <textarea name=text required rows=3></textarea>
      ${t`HTML`} <input type=checkbox name=html>
    </u2-fields>
    <div><button type=button data-send>${t`Send`}</button></div>
  </form>`;
}

export async function chats(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const rows = await chatList(node.app);
  // translated once, not per row — parallel t() of the same new string collides in smalltext
  const labels = { test: await t`Send a test message`, del: await t`Disconnect this chat?` };
  const body = rows.length
    ? rows.map((r) => chat(r, labels))
    : html`<tr><td colspan=6>${await t`Nobody has connected yet.`}`;

  return html.async`<div class=-head>${t`Chats`} (${rows.length})</div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`User`}
      <th>${t`Telegram`}
      <th>${t`Chat`}
      <th>${t`Since`}
      <th>${t`Last error`}
      <th>
    <tbody>${body}
  </table>`;
}

function chat(c: Row, labels: Record<string, string>): HtmlString {
  return html`<tr>
    <td>${c.email ?? "#" + c.usr_id}
    <td>${c.username ? "@" + c.username : "-"}
    <td>${c.chat_id}
    <td>${u2.time(c.created)}
    <td>${c.error ? html`<span class=u2-badge title="${c.error}">${String(c.error).slice(0, 24)}</span>` : ""}
    <td>
      <button type=button class=u2-unstyle data-test="${c.id}" title="${labels.test}"><u2-ico icon=send>➤</u2-ico></button>
      <button type=button class=u2-unstyle data-delete="${c.id}"
        u2-confirm="${labels.del}"><u2-ico icon=delete>✕</u2-ico></button>`;
}
