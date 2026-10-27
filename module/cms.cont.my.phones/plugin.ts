import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    single: { type: "boolean", description: "Only the main phone number: a new one replaces it once verified." },
  },
};

export const cms = { node: { js: ["pub/main.js"], render, settingsSchema } };

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;
  const single = Boolean(await node.settings.single);
  return html.async`<div ${single ? "data-single" : ""}>
  <div data-phones>${t`Loading…`}</div>
  <form data-add>
    <u2-fields>
      ${t`Phone number`} <input type=tel name=number placeholder="+41 79 123 45 67" required>
    </u2-fields>
    <button>${single ? t`Set phone number` : t`Add phone number`}</button>
  </form>
  <output class=-msg></output>
</div>`;
}
