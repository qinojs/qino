import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** The period to take along, last year by default, and what comes with it. */
export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const year = new Date().getFullYear() - 1;
  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:0 1 auto">
    <div class=-head>${t`Export for the fiduciary`}</div>
    <form data-export>
      <input type=date name=from value="${year}-01-01" required> –
      <input type=date name=to value="${year}-12-31" required>
      <button>${t`Download`}</button>
    </form>
    <p><small>${t`A ZIP: the journal and the balances as CSV, and the receipts.`}</small>
    <p><small>${t`The export lives in this page for now and may move into a module of its own.`}</small>
  </div>
</div>`;
}
