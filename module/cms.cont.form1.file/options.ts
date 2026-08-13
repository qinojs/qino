import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default function (node: Node, _vars: unknown): Promise<HtmlString> {
  const t = node.app.t;
  const settings = node.settings;
  const set = (key: string) => html.raw(` data-node="${node.id}" data-key="${key}" data-file-setting`);

  return html.async`
<label>
  ${t`Accepted file types:`}
  <textarea${set("accept")}>${settings.accept()}</textarea>
</label>
<label><input type=checkbox${set("required")}${settings.required() ? html.raw(" checked") : ""}> ${t`Required`}</label>
<label><input type=checkbox${set("multiple")}${settings.multiple() ? html.raw(" checked") : ""}> ${t`Allow multiple files`}</label>

<p>${t`Examples:`}</p>
<table>
  <tr>
    <td>${t`All images`}
    <td>image/*
  <tr>
    <td>${t`Only JPEG`}
    <td>image/jpeg
  <tr>
    <td>PDF
    <td>application/pdf
  <tr>
    <td>${t`PDF and Word`}
    <td>application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document
</table>`;
}
