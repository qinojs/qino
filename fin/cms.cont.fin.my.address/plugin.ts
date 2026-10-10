import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

/** A user's postal address, where their invoices go. */
function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<form data-address>
  <u2-fields>
    ${t`Street`} <input name=streetAddress autocomplete=street-address>
    ${t`Postal code`} <input name=postalCode autocomplete=postal-code size=8>
    ${t`Place`} <input name=addressLocality autocomplete=address-level2>
    ${t`Region`} <input name=addressRegion autocomplete=address-level1>
    ${t`Country`} <input name=addressCountry autocomplete=country maxlength=2 size=3 placeholder=CH>
  </u2-fields>
  <button>${t`Save`}</button>
  <p><small>${t`New invoices go here; issued ones keep the address they were issued with.`}</small>
  <output class=-msg></output>
</form>`;
}
