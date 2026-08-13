import * as u2 from "@qino/qino/u2";
import type { Node } from "@qino/qino/cms";
import { html, type HtmlString, type Row } from "@qino/qino";
import { pendingPhones, phones as phoneList } from "@qino/qino/messaging.sms";

export function render(node: Node): Promise<HtmlString> {
  return html.async`<div class=u2-flex>
  <div class=u2-card cms-part=provider>${provider(node)}</div>
  <div class=u2-card cms-part=send>${send(node)}</div>
  <div class=u2-card cms-part=phones>${phones(node)}</div>
</div>`;
}

export async function provider(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const root = node.app.settings["messaging.sms"].provider;
  const type = String(await root.type ?? "");
  const twilio = root.twilio;
  const http = root.http;
  const secret = async (name: string) => Boolean(await twilio[name]);
  const httpToken = Boolean(await http.token);

  return html.async`<div class=-head>${t`Provider`}</div>
  <form class=-body>
    <u2-fields>
      ${t`Type`} <select name=type data-provider-type required>
        <option value="">${t`Choose…`}</option>
        <option value=twilio${type === "twilio" ? " selected" : ""}>Twilio</option>
        <option value=http${type === "http" ? " selected" : ""}>HTTP JSON</option>
      </select>
    </u2-fields>
    <u2-fields data-provider-fields=twilio${type === "twilio" ? "" : " hidden"}>
      ${t`Account SID`} <input name=accountSid value="${await twilio.accountSid}">
      ${t`API key SID`} <input name=apiKeySid value="${await twilio.apiKeySid}">
      ${t`API key secret`} <input type=password name=apiKeySecret autocomplete=off
        placeholder="${await secret("apiKeySecret") ? "••••••" : ""}">
      ${t`Auth token`} <input type=password name=authToken autocomplete=off
        placeholder="${await secret("authToken") ? "••••••" : ""}">
      ${t`From`} <input name=twilioFrom value="${await twilio.from}">
      ${t`Messaging Service SID`} <input name=messagingServiceSid value="${await twilio.messagingServiceSid}">
    </u2-fields>
    <u2-fields data-provider-fields=http${type === "http" ? "" : " hidden"}>
      ${t`URL`} <input type=url name=url value="${await http.url}">
      ${t`Bearer token`} <input type=password name=httpToken autocomplete=off
        placeholder="${httpToken ? "••••••" : ""}">
      ${t`From`} <input name=httpFrom value="${await http.from}">
    </u2-fields>
    <button type=button data-provider-save>${t`Save`}</button>
  </form>`;
}

/** Only groups and users with a preferred verified phone are offered. */
export async function send(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const db = node.app.db;
  const [groupRows, userRows] = await Promise.all([
    db.query`
      SELECT g.id, g.name, COUNT(DISTINCT p.usr_id) AS phones
      FROM usr_phone p
      JOIN usr_grp ug ON ug.usr_id = p.usr_id
      JOIN grp g ON g.id = ug.grp_id
      WHERE p.id = (SELECT other.id FROM usr_phone other WHERE other.usr_id = p.usr_id
        ORDER BY other.main DESC, other.created, other.id LIMIT 1)
      GROUP BY g.id, g.name ORDER BY g.name`,
    db.query`
      SELECT p.usr_id, u.email, COUNT(*) AS phones
      FROM usr_phone p LEFT JOIN usr u ON u.id = p.usr_id
      WHERE p.id = (SELECT other.id FROM usr_phone other WHERE other.usr_id = p.usr_id
        ORDER BY other.main DESC, other.created, other.id LIMIT 1)
      GROUP BY p.usr_id, u.email ORDER BY u.email`,
  ]);
  const groupOptions = groupRows.map((g) => html`<option value="grp:${g.id}">${g.name} (${g.phones})</option>`);
  const userOptions = userRows.map((u) => html`<option value="usr:${u.usr_id}">${u.email ?? "#" + u.usr_id}</option>`);

  return html.async`<div class=-head>${t`Send message`}</div>
  <form class=-body>
    <u2-fields>
      ${t`To`} <select name=to>
        <option value=all>${t`All users with SMS`}</option>
        <optgroup label="${await t`Groups`}">${groupOptions}</optgroup>
        <optgroup label="${await t`Users`}">${userOptions}</optgroup>
      </select>
      ${t`Text`} <textarea name=text required rows=3></textarea>
    </u2-fields>
    <button type=button data-send>${t`Send`}</button>
  </form>`;
}

export async function phones(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const [rows, claims] = await Promise.all([phoneList(node.app), pendingPhones(node.app)]);
  const labels = {
    approve: await t`Approve without code`,
    main: await t`Make main number`,
    test: await t`Send a test SMS`,
    del: await t`Delete this phone number?`,
    pending: await t`pending`,
  };
  const body = rows.length || claims.length
    ? [...rows.map((p) => phone(p, labels)), ...claims.map((c) => claim(c, labels))]
    : html`<tr><td colspan=6>${await t`No phone numbers yet.`}`;

  return html.async`<div class=-head>${t`Phone numbers`} (${rows.length})</div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`User`}
      <th>${t`Number`}
      <th>${t`Main`}
      <th>${t`Verified`}
      <th>${t`Last error`}
      <th>
    <tbody>${body}
  </table>`;
}

function phone(p: Row, labels: Record<string, string>): HtmlString {
  return html`<tr>
    <td>${p.email ?? "#" + p.usr_id}
    <td>${p.number}
    <td>${p.main ? "✓" : ""}
    <td>${u2.el.time(p.created)}
    <td>${p.error ? html`<span class=u2-badge title="${p.error}">${String(p.error).slice(0, 24)}</span>` : ""}
    <td>
      ${p.main ? "" : html`<button type=button class=u2-unstyle data-main="${p.id}" title="${labels.main}">★</button>`}
      <button type=button class=u2-unstyle data-test="${p.id}" title="${labels.test}"><u2-ico icon=send>➤</u2-ico></button>
      <button type=button class=u2-unstyle data-delete="${p.id}" u2-confirm="${labels.del}"><u2-ico icon=delete>✕</u2-ico></button>`;
}

/** A number someone claimed but has not proven yet — it belongs to no user until they do. */
function claim(c: Row, labels: Record<string, string>): HtmlString {
  return html`<tr>
    <td>${c.email ?? "#" + c.usr_id}
    <td>${c.address}
    <td>
    <td><span class=u2-badge>${labels.pending}</span>
    <td>
    <td><button type=button class=u2-unstyle data-approve="${c.address}" title="${labels.approve}">✓</button>`;
}
