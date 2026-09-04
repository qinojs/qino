import { html } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    apiBase:             { type: "string", description: "Base URL of the WebAuthn API. Default: derived from app path." },
    showPasswordFallback:{ type: "boolean", description: "Also shows a classic password form." },
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

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  if (ctx.user && !await node.edit()) return html.raw(""); // nothing to offer once logged in
  const app = node.app;
  const settings = node.settings;
  const showPw = !!settings.showPasswordFallback();
  const apiBase = String(settings.apiBase() ?? "") || ctx.req.appUrl + "api/auth.webauthn";

  const redirectId = Number(settings.redirectAfterLogin());
  let redirectUrl = "";
  if (redirectId) {
    const p = await node.cms.node(redirectId);
    if (p?.exists()) redirectUrl = await p.url();
  }

  return html.async`<div data-api-base="${apiBase}" data-redirect-url="${redirectUrl}">
  <input type=email placeholder="${app.t`E-Mail (optional)`}" data-email autocomplete="username webauthn">
  <button data-action=login>${app.t`Sign in with passkey`}</button>
  ${showPw ? html.async`<details>
    <summary>${app.t`Sign in with password`}</summary>
    <form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <table>
        <tr>
          <th>${app.t`E-Mail`}:
          <td><input name=email type=email required>
        <tr>
          <th>${app.t`Password`}:
          <td><input name=pw type=password required>
        <tr>
          <th>
          <td><button name=core_login>${app.t`Sign in`}</button>
      </table>
    </form>
  </details>` : ""}
  <output class=-msg></output>
</div>`;
}
