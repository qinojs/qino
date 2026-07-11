import type { Node } from "../cms/mod.ts";
import { getCtx, html, type App, type HtmlString } from "../core/mod.ts";

export const name = "cms.cont.web_auth";
export const needs = ["web_auth"];

const settingsSchema = {
  properties: {
    mode:                { type: "string", enum: ["auto", "login", "manage"], description: "auto = login when logged out, manage when logged in." },
    apiBase:             { type: "string", description: "Base URL of the web_auth API. Default: derived from app path." },
    showPasswordFallback:{ type: "boolean", description: "Also shows a classic password form." },
    redirectAfterLogin:  { type: "integer", minimum: 1, description: "Page ID to redirect to after login." },
  },
};

export const cms = { node: { js: ["pub/main.js"], render, settingsSchema } };

async function render(node: Node): Promise<string | HtmlString> {
  const ctx     = getCtx();
  const settings = node.settings;
  const mode    = String(settings.mode() ?? "auto");

  const showManage = mode === "manage" || (mode === "auto" && !!ctx.user);
  const showLogin  = mode === "login"  || (mode === "auto" && !ctx.user);

  const apiBase   = String(settings.apiBase() ?? "") || ctx.req.basePath + "api/web_auth";

  if (showManage && ctx.user) return renderManage(node.app, apiBase);
  if (showLogin) {
    const redirectId = Number(settings.redirectAfterLogin() ?? 0);
    let redirectUrl  = "";
    if (redirectId) {
      const P = await node.app.cms?.node(redirectId);
      if (P?.exists()) redirectUrl = await P.url();
    }
    return renderLogin(node.app, apiBase, !!(settings.showPasswordFallback()), redirectUrl, ctx.csrfToken);
  }
  return "";
}

function renderLogin(app: App, apiBase: string, showPw: boolean, redirectUrl: string, csrfToken: string): Promise<HtmlString> {
  return html.async`<div class="web-auth-login" data-api-base="${apiBase}" data-redirect-url="${redirectUrl}">
  <input type="email" placeholder="${app.t`E-Mail (optional)`}" data-email autocomplete="username webauthn">
  <button data-action="login">${app.t`Sign in with passkey`}</button>
  ${showPw ? html.async`<details>
    <summary>${app.t`Sign in with password`}</summary>
    <form method="post">
      <input type=hidden name=csrfToken value="${csrfToken}">
      <table>
        <tr><th>${app.t`E-Mail`}:<td><input name="email" type="email" required>
        <tr><th>${app.t`Password`}:<td><input name="pw" type="password" required>
        <tr><th><td><button name="core_login">${app.t`Sign in`}</button>
      </table>
    </form>
  </details>` : ""}
  <output class="-msg"></output>
</div>`;
}

function renderManage(app: App, apiBase: string): Promise<HtmlString> {
  return html.async`<div class="web-auth-manage" data-api-base="${apiBase}">
  <div data-list>${app.t`Loading…`}</div>
  <input type="text" data-name placeholder="${app.t`Name for this authenticator`}">
  <button data-action="register">${app.t`Add passkey`}</button>
  <output class="-msg"></output>
</div>`;
}
