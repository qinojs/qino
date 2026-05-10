// deno-lint-ignore-file no-explicit-any
// Port of cms.cont.login4/index.php
import type { Node } from "../cms/lib/Node.ts";
import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/RequestContext.ts";

export const name = "cms.cont.login4";

const settingsSchema = {
  properties: {
    redirect: { type: "integer", minimum: 1, description: "Page-ID, zu der bereits eingeloggte Benutzer automatisch weitergeleitet werden." },
    history: { type: "integer", minimum: 0, description: "Anzahl der zuletzt verwendeten Logins, die als Schnelllogin angezeigt werden." },
    saveLogin: { type: "boolean", description: "Zeigt im Loginformular die Option, angemeldet zu bleiben." },
    "fix user": { type: "string", description: "Feste Benutzerkennung fuer dieses Formular. Wenn gesetzt, wird kein E-Mail-Feld angezeigt." },
    "no autofocus": { type: "boolean", description: "Verhindert, dass das E-Mail-Feld beim Laden der Seite automatisch fokussiert wird." },
    logout_redirect: { type: "integer", minimum: 1, description: "Page-ID, die als Ziel fuer das Logout-Formular verwendet wird." },
  },
};

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const app = node.app;
  const edit = node.edit;
  const cms = node.cms;
  const settings = node.settings;

  // Redirect if already logged in
  if (!edit && ctx.user) {
    const redirectId = Number(settings.redirect());
    if (redirectId) {
      const P = await cms.node(redirectId);
      if (P.is()) {
        const url = await P.url();
        ctx.responseHeaders.set("Location", url);
        ctx.responseStatus = 302;
        return "";
      }
    }
  }

  // Login error message
  let errorHtml = "";
  const errorT = await node.text("login failed");
  if (!(await errorT.string())) {
    await errorT.lang("de").set("Ihr Loginversuch ist fehlgeschlagen");
  }
  if (ctx.loginError) {
    const errorText = await errorT.string();
    errorHtml = `<div class=loginError>${errorText}</div>`;
  }

  let html = `<div>\n${errorHtml}\n`;

  const usrIsLoggedIn = ctx.user;

  if (!usrIsLoggedIn || edit) {
    // Show history of recently logged-in users
    const historyLimit = Number(await settings.history) || 0;
    if (historyLimit > 0) {
      const client = ctx.client;
      const clientUsrs = await client.users();
      let i = 0;
      for (const clientUsr of Object.values(clientUsrs)) {
        if (++i > historyLimit) break;
        const email = hee(await ctx.user?.get("email") ?? "");
        const saveLogin = await (clientUsr as any).get("save_login");
        const saveLoginChecked = saveLogin ? " checked" : "";
        const showSaveLogin = await settings.saveLogin;
        const showPwField = !saveLogin;

        html += `<form method=post>
  ${
          showSaveLogin
            ? `<input name=save_login type=checkbox value=1${saveLoginChecked}>`
            : ""
        }
  ${email}
  <input name=email type=hidden value="${email}">
  ${showPwField ? `<input name=pw type=password>` : ""}
  <button name=liveUser_login>${await app.t`login`}</button>
</form>\n`;
      }
    }

    // Main login form
    const fixUser = await settings["fix user"];
    const noAutofocus = await settings["no autofocus"];
    const showSaveLogin = await settings.saveLogin;

    html += `<form method=post>
  ${fixUser ? `<input type=hidden name=email value="${hee(fixUser)}">` : ""}
  <table class="c1-padding c1-fieldTable">
    ${
      !fixUser
        ? `<tr class=-email>
      <th>${await cms.text(node, "user", {
          tag: "div",
          initial: { de: "E-Mail:" },
        })}
      <td><input name=email type=text required${
          noAutofocus ? "" : " autofocus"
        }>`
        : ""
    }
    <tr class=-pw>
      <th>${await cms.text(node, "pw", {
      tag: "div",
      initial: { de: "Passwort:" },
    })}
      <td><input name=pw type=password required>
    <tr class=-login>
      <th>
      <td><button name=liveUser_login>${await app.t`Anmelden`}</button>
    ${
      showSaveLogin
        ? `<tr class=-save_login>
      <th>
        ${await cms.text(node, "saveLogin", {
          tag: "div",
          initial: { de: "Eingeloggt bleiben:" },
        })}
      <td><label><input name=save_login type=checkbox value=1 class=c1-fakable><i></i></label>`
        : ""
    }
  </table>
</form>\n`;
  } else {
    // Logout form
    const logoutRedirectId = Number(await settings.logout_redirect);
    let action = "";
    if (logoutRedirectId) {
      const P = await cms.node(logoutRedirectId);
      if (P.is()) {
        action = ` action="${await P.url()}"`;
      }
    }
    html += `<form method=post${action}>
  <button name=liveUser_logout>${await app.t`Abmelden`}</button>
</form>\n`;
  }

  html += "</div>";
  return html;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
