import { html } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    logout_redirect: { type: "integer", minimum: 1, description: "Page ID used as the target for the logout form." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  if (!ctx.user && !await node.edit()) return html.raw("");
  const app = node.app;
  const cms = node.cms;
  const settings = node.settings;
  const csrfToken = ctx.csrfToken;
  // Logout form
  const logoutRedirectId = Number(settings.logout_redirect());
  let action: HtmlString | string = "";
  if (logoutRedirectId) {
    const page = await cms.node(logoutRedirectId);
    if (page.exists()) action = html` action="${await page.url()}"`;
  }
  return html.async`<form method=post${action}>
  <input type=hidden name=csrfToken value="${csrfToken}">
  <button name=core_logout>${app.t`Log out`}</button>
</form>`;
}

export const cms = { node: { render, settingsSchema } };
