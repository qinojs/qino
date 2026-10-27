import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    single: { type: "boolean", description: "Only the main email address: a new one replaces it once verified." },
  },
};

export const cms = { node: { js: ["pub/main.js"], render, settingsSchema } };

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  const single = Boolean(await node.settings.single);
  return html.async`<div ${single ? "data-single" : ""}>
  <div data-emails>${t`Loading…`}</div>
  <form data-add>
    <u2-fields>
      ${t`Email address`} <input type=email name=address placeholder="name@example.com" required>
    </u2-fields>
    <button>${single ? t`Set email address` : t`Add email address`}</button>
  </form>
  <output class=-msg></output>
</div>`;
}
