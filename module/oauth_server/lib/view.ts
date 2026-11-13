import { html } from "@qino/qino";
import { page } from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";

// Root routes, not CMS pages: u2.page() keeps them apart from any layout (a sign-in form).

/** Sign-in form with core's fields (`core_login`), so `loginFromRequest` handles the POST. Posting
 *  to the same URL keeps the authorization params. */
export async function loginPage(ctx: Ctx, client: string): Promise<never> {
  const t = ctx.app.t;
  const title = await t`Sign in`;
  const failed = !ctx.loginError ? "" : await (
    ctx.loginError === "pending"
      ? t`One more step: confirm it is you.`
      : ctx.loginError === "throttled"
      ? t`Too many attempts. Please try again in ${ctx.loginRetryAfter ?? 0} seconds.`
      : t`Your login attempt failed`
  );
  return page(ctx, title, await html.async`
  <p>${t`${client} wants to access your account.`}</p>
  ${failed ? html`<p><strong>${failed}</strong></p>` : ""}
  <form method=post action="${ctx.req.url.href}">
    <input type=hidden name=core_login value=1>
    <input type=hidden name=csrfToken value="${ctx.csrfToken}">
    <p><label>${t`Email`} <input type=email name=email autocomplete=username required autofocus></label></p>
    <p><label>${t`Password`} <input type=password name=pw autocomplete=current-password required></label></p>
    <button>${title}</button>
  </form>`);
}

/** Consent form: the one place where a user grants a client access to their account. */
export async function consentPage(ctx: Ctx, client: string, redirectUri: string): Promise<never> {
  const t = ctx.app.t;
  const title = await t`Authorize ${client}`;
  return page(ctx, title, await html.async`
  <p>${t`Signed in as ${ctx.user?.username}.`}</p>
  <p>${t`${client} will be able to act on your behalf, with all your permissions.`}</p>
  <dl>
    <dt>${t`Redirect target`}</dt>
    <dd>${new URL(redirectUri).origin}</dd>
  </dl>
  <form method=post action="${ctx.req.url.href}">
    <input type=hidden name=csrfToken value="${ctx.csrfToken}">
    <button name=oauth_consent value=1>${t`Allow`}</button>
    <button name=oauth_deny value=1>${t`Deny`}</button>
  </form>`);
}

/** Authorization errors that must not be redirected back (unknown client, bad redirect_uri). */
export async function errorPage(ctx: Ctx, message: string): Promise<never> {
  const title = await ctx.app.t`Authorization failed`;
  return page(ctx, title, html`<p>${message}</p>`, { status: 400 });
}
