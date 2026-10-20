import { html } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    redirect: { type: "integer", minimum: 1, description: "Page ID to redirect already-logged-in users to automatically." },
    saveLogin: { type: "boolean", default: true, description: "Shows the 'stay logged in' option in the login form." },
    "fix user": { type: "string", description: "Fixed user identifier for this form. When set, the e-mail field is not shown." },
    "no autofocus": { type: "boolean", description: "Prevents the e-mail field from being auto-focused on page load." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString | string> {
  const app = node.app;
  const edit = await node.edit();
  const cms = node.cms;
  const settings = node.settings;

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

  if (ctx.user && !edit) return html.raw("");
  const csrfToken = ctx.csrfToken;

  // Login error message
  let errorHtml: HtmlString | string = "";
  const errorT = await node.text("login failed");
  if (!(await errorT.string())) await errorT.lang("en").set("Your login attempt failed");
  if (ctx.loginError === "pending") {
    // no failure: the password was right and one more proof is owed; core loads the script that asks
    errorHtml = html`<div class=loginError>${await app.t`One more step: confirm it is you.`}</div>`;
  } else if (ctx.loginError === "throttled") {
    const secs = ctx.loginRetryAfter ?? 0;
    const msg = secs < 60
      ? await app.t`Too many attempts. Please try again in ${secs} seconds.`
      : await app.t`Too many attempts. Please try again in ${Math.ceil(secs / 60)} minutes.`;
    errorHtml = html`<div class=loginError>${msg}</div>`;
  } else if (ctx.loginError) {
    errorHtml = html`<div class=loginError>${html.raw(await node.showText("login failed"))}</div>`; // sanitized, like every text output
  }

  const showSaveLogin = settings.saveLogin();

  // Main login form
  const fixUser = settings["fix user"]();
  const noAutofocus = settings["no autofocus"]();

  return html.async`<div>
${errorHtml}
  <form method=post>
  <input type=hidden name=csrfToken value="${csrfToken}">
  ${fixUser ? html`<input name=email type=text value="${fixUser}" autocomplete=username readonly hidden>` : ""}
  <table class="u2-table -Flex -NoSideGaps">
    ${
      !fixUser
        ? html.async`<tr class=-email>
      <th>${cms.text(node, "user", {
          tag: "div",
          initial: { en: "E-Mail:" },
        })}
      <td><input name=email type=text autocomplete=username autocapitalize=none required${
          noAutofocus ? "" : " autofocus"
        }>`
        : ""
    }
    <tr class=-pw>
      <th>${cms.text(node, "pw", {
      tag: "div",
      initial: { en: "Password:" },
    })}
      <td><input name=pw type=password autocomplete=current-password required>
    ${
      showSaveLogin
        ? html.async`<tr class=-save_login>
      <th>
        ${cms.text(node, "saveLogin", {
          tag: "div",
          initial: { en: "Stay logged in:" },
        })}
      <td><label><input name=save_login type=checkbox value=1></label>`
        : ""
    }
    <tr class=-login>
      <th>
      <td><button name=core_login>${app.t`Log in`}</button>
  </table>
  </form>
</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
