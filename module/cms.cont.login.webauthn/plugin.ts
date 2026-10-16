import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    apiBase:             { type: "string", description: "Base URL of the WebAuthn API. Default: derived from app path." },
    redirectAfterLogin:  { type: "integer", minimum: 1, description: "Page ID to redirect to after login." },
  },
};

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    settingsSchema,
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  if (ctx.user && !await node.edit()) return html.raw(""); // nothing to offer once logged in
  const app = node.app;
  const settings = node.settings;
  const apiBase = String(settings.apiBase() ?? "") || ctx.req.appUrl + "api/auth.webauthn";

  const redirectId = Number(settings.redirectAfterLogin());
  let redirectUrl = "";
  if (redirectId) {
    const p = await node.cms.node(redirectId);
    if (p.exists()) redirectUrl = await p.url();
  }

  return html.async`<form method=post data-api-base="${apiBase}" data-redirect-url="${redirectUrl}">
  <button data-action=login>${app.t`Sign in with passkey`}</button>
  <output class=-msg></output>
</form>`;
}
