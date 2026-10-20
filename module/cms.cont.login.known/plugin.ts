import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    history: { type: "integer", minimum: 0, description: "Maximum number of known accounts to show. Empty or 0 shows all." },
    saveLogin: { type: "boolean", default: true, description: "Shows the 'stay logged in' option in the login forms." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  if (ctx.user && !await node.edit()) return html.raw("");
  const app = node.app;
  const settings = node.settings;
  const showSaveLogin = settings.saveLogin();
  const csrfToken = ctx.csrfToken;
  const out = [];

  // Show accounts known to this client
  const historyLimit = Number(settings.history()) || Infinity;
  const client = ctx.client;
  const clientUsrs = await client.users();
  let i = 0;
  for (const clientUsr of Object.values(clientUsrs)) {
    if (++i > historyLimit) break;
    const email = (await clientUsr.user())?.username;
    const saveLogin = clientUsr.save_login;
    const saveLoginChecked = saveLogin ? " checked" : "";
    const showPwField = !saveLogin;

    out.push(html.async`<form method=post>
  ${
      showSaveLogin
        ? html.async`<label><input name=save_login type=checkbox value=1${saveLoginChecked}>${app.t`Stay logged in`}</label>`
        : ""
    }
  ${email}
  <input name=email type=text value="${email}" autocomplete=username readonly hidden>
  <input type=hidden name=csrfToken value="${csrfToken}">
  ${showPwField ? html`<input name=pw type=password autocomplete=current-password>` : ""}
  <button name=core_login>${app.t`Log in`}</button>
</form>\n`);
  }

  if (!out.length) return html.raw("");
  return html.async`<div>
    ${ctx.loginError && ctx.loginError !== "pending" ? html.async`<div class=loginError>${app.t`Your login attempt failed`}</div>` : ""}
    ${out}
  </div>`;
}

export const cms = { node: { render, settingsSchema } };
