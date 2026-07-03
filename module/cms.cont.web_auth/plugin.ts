// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/mod.ts";
import { getCtx, hee } from "../core/mod.ts";

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

async function render(node: Node): Promise<string> {
  const ctx     = getCtx();
  const settings = node.settings;
  const mode    = String(settings.mode() ?? "auto");

  const showManage = mode === "manage" || (mode === "auto" && !!ctx.user);
  const showLogin  = mode === "login"  || (mode === "auto" && !ctx.user);

  const apiBase   = String(settings.apiBase() ?? "") || ctx.appURL + "api/web_auth";

  if (showManage && ctx.user) return renderManage(node.app, apiBase);
  if (showLogin) {
    const redirectId = Number(settings.redirectAfterLogin() ?? 0);
    let redirectUrl  = "";
    if (redirectId) {
      const P = await (node.app as any).cms?.node(redirectId);
      if (P?.is()) redirectUrl = await P.url();
    }
    return renderLogin(node.app, apiBase, !!(settings.showPasswordFallback()), redirectUrl, hee(ctx.token));
  }
  return "";
}

async function renderLogin(app: any, apiBase: string, showPw: boolean, redirectUrl: string, token: string): Promise<string> {
  return `<div class="web-auth-login" data-api-base="${hee(apiBase)}" data-redirect-url="${hee(redirectUrl)}">
  <input type="email" placeholder="${await app.t`E-Mail (optional)`}" data-email autocomplete="username webauthn">
  <button data-action="login">${await app.t`Sign in with passkey`}</button>
  ${showPw ? `<details>
    <summary>${await app.t`Sign in with password`}</summary>
    <form method="post">
      <input type=hidden name=token value="${token}">
      <table>
        <tr><th>${await app.t`E-Mail`}:<td><input name="email" type="email" required>
        <tr><th>${await app.t`Password`}:<td><input name="pw" type="password" required>
        <tr><th><td><button name="liveUser_login">${await app.t`Sign in`}</button>
      </table>
    </form>
  </details>` : ""}
  <output class="-msg"></output>
</div>`;
}

async function renderManage(app: any, apiBase: string): Promise<string> {
  return `<div class="web-auth-manage" data-api-base="${hee(apiBase)}">
  <div data-list>${await app.t`Loading…`}</div>
  <input type="text" data-name placeholder="${await app.t`Name for this authenticator`}">
  <button data-action="register">${await app.t`Add passkey`}</button>
  <output class="-msg"></output>
</div>`;
}
