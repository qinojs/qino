import { html, Output, type Ctx, type HtmlString } from "../../core/mod.ts";

/** Standalone document — the authorization endpoint is a root route, not a CMS page. */
function page(ctx: Ctx, title: string, body: HtmlString, status = 200): never {
  ctx.res.html.title = title;
  ctx.res.html.content = body.html;
  ctx.res.status = status;
  throw new Output(); // stop the route here — the document on ctx.res is the response
}

/** Sign-in form. The fields are the core's (`core_login`), so `authListen` logs the user in on
 *  POST — before any route runs. Posting to the same URL keeps the authorization params. */
export async function loginPage(ctx: Ctx, client: string): Promise<never> {
  const t = ctx.app.t;
  const title = await t`Sign in`;
  page(ctx, title, await html.async`<main>
  <h1>${title}</h1>
  <p>${t`${client} wants to access your account.`}</p>
  ${ctx.loginError ? html`<p><strong>${await t`Your login attempt failed`}</strong></p>` : ""}
  <form method=post action="${ctx.req.url.href}">
    <input type=hidden name=core_login value=1>
    <input type=hidden name=csrfToken value="${ctx.csrfToken}">
    <p><label>${t`Email`} <input type=email name=email autocomplete=username required autofocus></label></p>
    <p><label>${t`Password`} <input type=password name=pw autocomplete=current-password required></label></p>
    <button>${title}</button>
  </form>
</main>`);
}

/** Consent form: the one place where a user grants a client access to their account. */
export async function consentPage(ctx: Ctx, client: string, redirectUri: string): Promise<never> {
  const t = ctx.app.t;
  const title = await t`Authorize ${client}`;
  page(ctx, title, await html.async`<main>
  <h1>${title}</h1>
  <p>${t`Signed in as ${ctx.user?.email}.`}</p>
  <p>${t`${client} will be able to act on your behalf, with all your permissions.`}</p>
  <dl>
    <dt>${t`Redirect target`}</dt>
    <dd>${new URL(redirectUri).origin}</dd>
  </dl>
  <form method=post action="${ctx.req.url.href}">
    <input type=hidden name=csrfToken value="${ctx.csrfToken}">
    <button name=oauth_consent value=1>${t`Allow`}</button>
    <button name=oauth_deny value=1>${t`Deny`}</button>
  </form>
</main>`);
}

/** Authorization errors that must not be redirected back (unknown client, bad redirect_uri). */
export async function errorPage(ctx: Ctx, message: string): Promise<never> {
  const title = await ctx.app.t`Authorization failed`;
  page(ctx, title, html`<main><h1>${title}</h1><p>${message}</p></main>`, 400);
}
