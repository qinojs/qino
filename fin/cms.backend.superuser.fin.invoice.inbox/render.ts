import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { badge, money, rowLink } from "@qino/qino/cms.backend.superuser.fin";
import * as u2 from "@qino/qino/u2";

import type { HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Invoices come in here: uploaded, read, and waiting as drafts to be checked. */
export async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const invoices = (await backend.toModuleUrl(node, "cms.backend.superuser.fin.invoice"));
  const drafts = await app.db.query`
    SELECT * FROM invoice WHERE direction = 'in' AND status = 'draft' ORDER BY id DESC LIMIT 100`;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Read invoices`}</div>
    <form data-read>
      <input type=file name=files accept="application/pdf,image/*" multiple required>
      <button>${t`Read`}</button>
    </form>
    <p><small>${t`PDF or photo. A language model reads it into a draft, the file becomes its receipt.`}
      ${t`Check every draft before issuing it: the model may be wrong.`}</small>
    <p><small>${t`Reading lives in this page for now and may move into a module of its own.`}</small>
  </div>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`To check`}</div>
    ${drafts.length ? html.async`<div style="overflow:auto; max-height:70vh; padding:0"><table class=u2-table>
      <thead><tr>
        <th>${t`Supplier`}
        <th>${t`User`}
        <th>${t`Number`}
        <th>${t`Date`}
        <th>${t`Total`}
        <th>${t`Read`}
        <th>${t`Received`}
      <tbody>${drafts.map((row) => html.async`<tr u2-href>
        <td><a href="${invoices({ invoice: row.id })}">${supplier(row)}</a>
        <td>${row.usr_id
          ? rowLink(node, "cms.backend.superuser.fin.party", "usr", row.usr_id)
          : html.async`<button data-supplier="${row.id}">${t`Find or create`}</button>`}
        <td>${row.number}
        <td>${row.date}
        <td style="text-align:end; white-space:nowrap">${money(row.total, row.currency)}
        <td style="text-align:end; white-space:nowrap">${check(row)}
        <td style="white-space:nowrap">${u2.el.time(row.created, { narrow: true })}`)}
    </table></div>` : html.async`<p>${t`Nothing to check.`}`}
  </div>
</div>`;
}

const supplier = (row: Row) => String(JSON.parse(String(row.party ?? "{}"))?.name || `#${row.id}`);

/** The total as read beside the one the lines add up to: a difference is marked. */
function check(row: Row) {
  const read = JSON.parse(String(row.data ?? "{}"))?.read;
  if (read?.total == null) return "";
  const same = Number(read.total) === Number(row.total);
  return same ? money(read.total, row.currency) : badge(money(read.total, row.currency), "--red");
}
