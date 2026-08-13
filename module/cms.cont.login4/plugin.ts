// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/mod.ts";
import { html, type Ctx, type HtmlString } from "../core/mod.ts";

const settingsSchema = {
  properties: {
    redirect: { type: "integer", minimum: 1, description: "Page ID to redirect already-logged-in users to automatically." },
    history: { type: "integer", minimum: 0, description: "Number of recently used logins to display as quick-login buttons." },
    saveLogin: { type: "boolean", description: "Shows the 'stay logged in' option in the login form." },
    "fix user": { type: "string", description: "Fixed user identifier for this form. When set, the e-mail field is not shown." },
    "no autofocus": { type: "boolean", description: "Prevents the e-mail field from being auto-focused on page load." },
    logout_redirect: { type: "integer", minimum: 1, description: "Page ID used as the target for the logout form." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString | string> {
  const app = node.app;
  const edit = node.edit;
  const cms = node.cms;
  const settings = node.settings;
  const csrfToken = ctx.csrfToken;

  // Redirect if already logged in
  if (!edit && ctx.user) {
    const redirectId = Number(settings.redirect());
    if (redirectId) {
      const page = await cms.node(redirectId);
      if (page.exists()) {
        ctx.res.headers.set("Location", await page.url());
        ctx.res.status = 302;
        return "";
      }
    }
  }

  // Login error message
  let errorHtml: HtmlString | string = "";
  const errorT = await node.text("login failed");
  if (!(await errorT.string())) await errorT.lang("en").set("Your login attempt failed");
  if (ctx.loginError) {
    errorHtml = html`<div class=loginError>${html.raw(await errorT.string())}</div>`;
  }

  const out: HtmlString[] = [html`<div>\n${errorHtml}\n`];

  const usrIsLoggedIn = ctx.user;

  if (!usrIsLoggedIn || edit) {
    // Show history of recently logged-in users
    const historyLimit = Number(settings.history()) || 0;
    if (historyLimit > 0) {
      const client = ctx.client;
      const clientUsrs = await client.users();
      let i = 0;
      for (const clientUsr of Object.values(clientUsrs)) {
        if (++i > historyLimit) break;
        const email = (await clientUsr.user())?.email;
        const saveLogin = clientUsr.save_login;
        const saveLoginChecked = saveLogin ? " checked" : "";
        const showSaveLogin = settings.saveLogin();
        const showPwField = !saveLogin;

        out.push(html`<form method=post>
  ${
          showSaveLogin
            ? html`<input name=save_login type=checkbox value=1${saveLoginChecked}>`
            : ""
        }
  ${email}
  <input name=email type=hidden value="${email}">
  <input type=hidden name=csrfToken value="${csrfToken}">
  ${showPwField ? html`<input name=pw type=password>` : ""}
  <button name=core_login>${await app.t`Log in`}</button>
</form>\n`);
      }
    }

    // Main login form
    const fixUser = settings["fix user"]();
    const noAutofocus = settings["no autofocus"]();
    const showSaveLogin = settings.saveLogin();

    out.push(html`<form method=post>
  <input type=hidden name=csrfToken value="${csrfToken}">
  ${fixUser ? html`<input type=hidden name=email value="${fixUser}">` : ""}
  <table>
    ${
      !fixUser
        ? html`<tr class=-email>
      <th>${await cms.text(node, "user", {
          tag: "div",
          initial: { en: "E-Mail:" },
        })}
      <td><input name=email type=text required${
          noAutofocus ? "" : " autofocus"
        }>`
        : ""
    }
    <tr class=-pw>
      <th>${await cms.text(node, "pw", {
      tag: "div",
      initial: { en: "Password:" },
    })}
      <td><input name=pw type=password required>
    <tr class=-login>
      <th>
      <td><button name=core_login>${await app.t`Log in`}</button>
    ${
      showSaveLogin
        ? html`<tr class=-save_login>
      <th>
        ${await cms.text(node, "saveLogin", {
          tag: "div",
          initial: { en: "Stay logged in:" },
        })}
      <td><label><input name=save_login type=checkbox value=1 class=c1-fakable><i></i></label>`
        : ""
    }
  </table>
</form>\n`);
  } else {
    // Logout form
    const logoutRedirectId = Number(settings.logout_redirect());
    let action: HtmlString | string = "";
    if (logoutRedirectId) {
      const page = await cms.node(logoutRedirectId);
      if (page.exists()) action = html` action="${await page.url()}"`;
    }
    out.push(html`<form method=post${action}>
  <input type=hidden name=csrfToken value="${csrfToken}">
  <button name=core_logout>${await app.t`Log out`}</button>
</form>\n`);
  }

  out.push(html`</div>`);
  return html.join(out);
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
