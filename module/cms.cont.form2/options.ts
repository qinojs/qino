import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, _vars: unknown): Promise<HtmlString> {
  const t = node.app.t;
  const success = await node.cont("success", "cms.cont.text");
  const subject = await node.text("mailSubject");
  const before = await node.text("email_before");
  const after = await node.text("email_after");
  const set = (key: string) => html.raw(` data-node="${node.id}" data-key="${key}" data-form2-setting`);
  const check = (key: string, on: unknown, label: unknown) =>
    html.async`<label><input type=checkbox${set(key)}${on ? html.raw(" checked") : ""}> ${label}</label>`;

  return html.async`
<table class="u2-table -Fields -Flex -NoSideGaps">
  <tr>
    <td>${t`On success go to page`}
    <td><input type=number min=1 value="${node.settings.redirect()}"${set("redirect")}>
  <tr>
    <td>${t`…or show this content`}
    <td>${await success.html()}
  <tr>
    <td>${t`Recipients`}
    <td><textarea rows=2${set("recipients")}>${node.settings.recipients()}</textarea>
  <tr>
    <td>${t`Subject`}<br><small>${t`(the page title is used when empty)`}</small>
    <td><input cmstxt="${subject.id}" value="${await subject.string()}">
  <tr>
    <td>${t`E-Mail above`}
    <td><div class=-input contenteditable cmstxt="${before.id}">${html.raw(String(await before.string()))}</div>
  <tr>
    <td>${t`E-Mail below`}
    <td><div class=-input contenteditable cmstxt="${after.id}">${html.raw(String(await after.string()))}</div>
  <tr>
    <td>${t`Buttons`}
    <td>
      ${check("button", node.settings.button() ?? true, t`Submit`)}
      ${check("reset", node.settings.reset(), t`Reset`)}
</table>`;
}
