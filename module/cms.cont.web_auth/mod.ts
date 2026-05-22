// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/lib/Node.ts";
import { getCtx } from "../core/lib/RequestContext.ts";

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

export const cms = { node: { render, settingsSchema } };

async function render(node: Node): Promise<string> {
  const ctx     = getCtx();
  const settings = node.settings;
  const mode    = String(settings.mode() ?? "auto");

  const showManage = mode === "manage" || (mode === "auto" && !!ctx.user);
  const showLogin  = mode === "login"  || (mode === "auto" && !ctx.user);

  const apiBase   = String(settings.apiBase() ?? "") || ctx.appURL + "api/web_auth";
  const scriptUrl = ctx.sysURL + "web_auth/pub/web_auth.js";

  if (showManage && ctx.user) return renderManage(apiBase, scriptUrl);
  if (showLogin) {
    const redirectId = Number(settings.redirectAfterLogin() ?? 0);
    let redirectUrl  = "";
    if (redirectId) {
      const P = await (node.app as any).cms?.node(redirectId);
      if (P?.is()) redirectUrl = await P.url();
    }
    return renderLogin(apiBase, scriptUrl, !!(settings.showPasswordFallback()), redirectUrl);
  }
  return "";
}

function renderLogin(apiBase: string, scriptUrl: string, showPw: boolean, redirectUrl: string): string {
  const redirect = redirectUrl ? `window.location.href=${JSON.stringify(redirectUrl)}` : "window.location.reload()";
  return `<div class="web-auth-login">
  <input type="email" placeholder="E-Mail (optional)" data-web-auth-email autocomplete="username webauthn">
  <button data-web-auth-action="login">Sign in with passkey</button>
  ${showPw ? `<details>
    <summary>Sign in with password</summary>
    <form method="post">
      <table>
        <tr><th>E-Mail:<td><input name="email" type="email" required>
        <tr><th>Password:<td><input name="pw" type="password" required>
        <tr><th><td><button name="liveUser_login">Sign in</button>
      </table>
    </form>
  </details>` : ""}
  <output class="-msg"></output>
  <script type="module">
    import { initWebAuth } from ${JSON.stringify(scriptUrl)};
    initWebAuth({
      apiBase: ${JSON.stringify(apiBase)},
      onSuccess: () => { ${redirect}; },
      onError: (_, r) => { document.querySelector(".web-auth-login .-msg").value = "Login failed: " + (r.error ?? "unknown"); },
    });
  </script>
</div>`;
}

function renderManage(apiBase: string, scriptUrl: string): string {
  return `<div class="web-auth-manage">
  <div data-list>Loading…</div>
  <input type="text" data-web-auth-name placeholder="Name for this authenticator">
  <button data-web-auth-action="register">Add passkey</button>
  <output class="-msg"></output>
  <script type="module">
    import { WebAuth, initWebAuth } from ${JSON.stringify(scriptUrl)};
    const wa = new WebAuth({ apiBase: ${JSON.stringify(apiBase)} });

    const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const fmt = ts => new Date(ts * 1000).toLocaleDateString();

    async function loadList() {
      const list = document.querySelector(".web-auth-manage [data-list]");
      if (!list) return;
      try {
        const creds = await wa.listCredentials();
        list.innerHTML = creds.length
          ? creds.map(c => \`<div data-web-auth-credential>
              <strong>\${esc(c.name)}</strong>
              <small>\${fmt(c.created)} · \${fmt(c.lastUsed)}</small>
              <button data-web-auth-action="delete" data-web-auth-cred-id="\${c.id}">🗑</button>
            </div>\`).join("")
          : "No passkeys registered.";
      } catch { list.textContent = "Error loading."; }
    }

    loadList();

    initWebAuth({
      apiBase: ${JSON.stringify(apiBase)},
      onSuccess: (action) => { if (action === "register") { document.querySelector("[data-web-auth-name]").value = ""; loadList(); } },
      onError: (_, r) => { document.querySelector(".web-auth-manage .-msg").value = r.error ?? "Error"; },
    });
  </script>
</div>`;
}
