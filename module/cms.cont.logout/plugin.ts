import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    logout_redirect: { type: "integer", minimum: 1, description: "Page ID used as the target for the logout form." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  if (!ctx.user && !await node.edit()) return html.raw("");
  const redirectId = Number(node.settings.logout_redirect());
  const page = redirectId ? (await node.cms.node(redirectId)).exists() : undefined;
  return html.async`<form method=post${page ? html` action="${await page.url()}"` : ""}>
  <input type=hidden name=csrfToken value="${ctx.csrfToken}">
  <button name=core_logout>${node.app.t`Log out`}</button>
</form>`;
}

export const cms = { node: { render, settingsSchema } };
