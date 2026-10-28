import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

/** A user's name and organization; the browser fills and saves them. */
function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<form>
  <u2-fields>
    ${t`First name`} <input name=givenName autocomplete=given-name>
    ${t`Last name`} <input name=familyName autocomplete=family-name>
    ${t`Organization`} <input name=organization autocomplete=organization>
  </u2-fields>
  <button>${t`Save`}</button>
  <output class=-msg></output>
</form>`;
}
