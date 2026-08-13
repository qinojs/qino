import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, _vars: unknown): Promise<HtmlString> {
  const t = node.app.t;
  const success = await node.cont("success", "cms.cont.text");
  const subject = await node.text("mailSubject");
  const before = await node.text("email_before");
  const after = await node.text("email_after");

  return html.async`
<label>
  ${t`On success go to page:`}
  <input type=qcms-page value="${node.settings.redirect()}" data-node="${node.id}" data-key=redirect data-form2-setting>
</label>

<label>
  ${t`…or the content shown after sending:`}
  <div class=-preview>${await success.html()}</div>
</label>

<h2>${t`E-Mail`}</h2>

<label>
  ${t`Recipients:`}
  <input value="${node.settings.recipients()}" data-node="${node.id}" data-key=recipients data-form2-setting>
</label>

<label>
  ${t`Subject`} <small>${t`(the page title is used when empty)`}</small>
  <input cmstxt="${subject.id}" value="${await subject.string()}">
</label>

<label>
  ${t`E-Mail content above the entries:`}
  <div contenteditable cmstxt="${before.id}" class=-preview>${html.raw(String(await before.string()))}</div>
</label>

<label>
  ${t`E-Mail content below the entries:`}
  <div contenteditable cmstxt="${after.id}" class=-preview>${html.raw(String(await after.string()))}</div>
</label>

<label>
  <input type=checkbox data-node="${node.id}" data-key=button data-form2-setting${(node.settings.button() ?? true) ? html.raw(" checked") : ""}>
  ${t`Show submit button`}
</label>`;
}
