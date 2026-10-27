import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render } };

// The username field lets password managers file the new password under the right account.
function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  return html.async`<form>
  <input type=text name=username autocomplete=username value="${ctx.user.username}" hidden>
  <u2-fields>
    ${t`New password`} <input type=password name=pw autocomplete=new-password minlength=8 required>
  </u2-fields>
  <button>${t`Change password`}</button>
  <output class=-msg></output>
</form>`;
}
