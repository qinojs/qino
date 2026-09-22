import * as u2 from "@qino/qino/u2";
// deno-lint-ignore-file no-explicit-any
import { html, safeEqual } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const cms = { node: { render } };

type Preset = {
  issuer?: string;
  scopes: string;
  authorize_url?: string;
  token_url?: string;
  userinfo_url?: string;
  email_url?: string;
  console_url: string; // Wo man Client-ID/Secret erstellt
};

// Well-known providers, seeded on install; the admin adds client_id/secret and replaces placeholders.
// OIDC = issuer (discovery). OAuth2 = explicit endpoints. Authentik uses per-provider issuer mode.
const PRESETS: Record<string, Preset> = {
  google:     { issuer: "https://accounts.google.com", scopes: "openid email profile", console_url: "https://console.cloud.google.com/apis/credentials" },
  microsoft:  { issuer: "https://login.microsoftonline.com/common/v2.0", scopes: "openid email profile", console_url: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" }, // "common" statt fixem Tenant, damit es ohne Kunden-Tenant-ID sofort funktioniert
  apple:      { issuer: "https://appleid.apple.com", scopes: "openid email name", console_url: "https://developer.apple.com/account/resources/identifiers/list/serviceId" },
  auth0:      { issuer: "https://<tenant>.auth0.com", scopes: "openid email profile", console_url: "https://manage.auth0.com/" },
  okta:       { issuer: "https://<tenant>.okta.com", scopes: "openid email profile", console_url: "https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/" },
  keycloak:   { issuer: "https://<domain>/realms/<realm>", scopes: "openid email profile", console_url: "https://www.keycloak.org/docs/latest/server_admin/#proc-creating-oidc-client_server_administration_guide" },
  authentik:  { issuer: "https://<domain>/application/o/<application>/", scopes: "openid email profile", console_url: "https://docs.goauthentik.io/docs/add-secure-apps/providers/oauth2/" },
  zitadel:    { issuer: "https://<domain>", scopes: "openid email profile", console_url: "https://zitadel.com/docs/guides/manage/console/applications" },
  gitlab:     { issuer: "https://gitlab.com", scopes: "openid email profile", console_url: "https://gitlab.com/-/user_settings/applications" },
  linkedin:   { issuer: "https://www.linkedin.com/oauth", scopes: "openid email profile", console_url: "https://www.linkedin.com/developers/apps" },
  slack:      { issuer: "https://slack.com", scopes: "openid email profile", console_url: "https://api.slack.com/apps" },
  salesforce: { issuer: "https://login.salesforce.com", scopes: "openid email profile", console_url: "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm" },
  yahoo:      { issuer: "https://api.login.yahoo.com", scopes: "openid email profile", console_url: "https://developer.yahoo.com/apps/create/" },
  twitch:     { issuer: "https://id.twitch.tv/oauth2", scopes: "openid", console_url: "https://dev.twitch.tv/console/apps/create" }, // email-Claim braucht zusätzlich "user:read:email"-Scope + expliziten claims-Request, kein Standard-"profile"-Scope
  paypal:     { issuer: "https://www.paypal.com", scopes: "openid email profile", console_url: "https://developer.paypal.com/dashboard/applications/live" },
  github:   { scopes: "read:user user:email", authorize_url: "https://github.com/login/oauth/authorize", token_url: "https://github.com/login/oauth/access_token", userinfo_url: "https://api.github.com/user", email_url: "https://api.github.com/user/emails", console_url: "https://github.com/settings/applications/new" },
  discord:  { scopes: "identify email", authorize_url: "https://discord.com/oauth2/authorize", token_url: "https://discord.com/api/oauth2/token", userinfo_url: "https://discord.com/api/users/@me", console_url: "https://discord.com/developers/applications" },
  facebook: { scopes: "email public_profile", authorize_url: "https://www.facebook.com/v19.0/dialog/oauth", token_url: "https://graph.facebook.com/v19.0/oauth/access_token", userinfo_url: "https://graph.facebook.com/me?fields=id,name,email", console_url: "https://developers.facebook.com/apps/" },
  twitter:  { scopes: "users.read tweet.read", authorize_url: "https://twitter.com/i/oauth2/authorize", token_url: "https://api.twitter.com/2/oauth2/token", userinfo_url: "https://api.twitter.com/2/users/me", console_url: "https://console.x.com/" },
  spotify:  { scopes: "user-read-email", authorize_url: "https://accounts.spotify.com/authorize", token_url: "https://accounts.spotify.com/api/token", userinfo_url: "https://api.spotify.com/v1/me", console_url: "https://developer.spotify.com/dashboard" },
  bitbucket:{ scopes: "account email", authorize_url: "https://bitbucket.org/site/oauth2/authorize", token_url: "https://bitbucket.org/site/oauth2/access_token", userinfo_url: "https://api.bitbucket.org/2.0/user", console_url: "https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/" },
};
export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Login providers", de: "Login-Provider" });
  for (const [pname, def] of Object.entries(PRESETS)) {
    if (await app.db.one`SELECT id FROM oauth_provider WHERE name = ${pname}`) continue;
    await app.db.table("oauth_provider").insert({
      name: pname, issuer: def.issuer ?? "", authorize_url: def.authorize_url ?? "", token_url: def.token_url ?? "",
      userinfo_url: def.userinfo_url ?? "", email_url: def.email_url ?? "", client_id: "", client_secret: "",
      scopes: def.scopes, auto_create: 1, allowed_domains: "",
    });
  }
}

/** One editable form per provider (blank `p` = the "add" form). */
function providerForm(csrf: string, selfBase: string, action: string, p: any = {}): HtmlString {
  const v = (k: string) => p[k];
  const isNew = !p.id;
  const checked = (isNew || Number(p.auto_create)) ? " checked" : "";
  const text = (k: string, ph = "") => html`<input name=${k} value="${v(k)}" placeholder="${ph}" autocomplete=off>`;
  // autocomplete: a password field makes the browser read the whole form as a login and offer the
  // saved one; `new-password` says this is not that form.
  return html`<form method=post action="${action}" autocomplete=off>

  ${isNew ? "" : 
    html`<div style="margin-bottom:1em">
    ${PRESETS[v("name")]?.console_url ? 
      html`<a href="${PRESETS[v("name")]?.console_url ?? "#"}" target=_blank rel=noopener>Provider console</a><br>
    ` : ""}
    <small>Redirect URI: <code>${selfBase + "oauth/callback/" + String(p.name)}</code></small>
  </div>`}
  <div>
    <input type=hidden name=csrfToken value="${csrf}">
    <input type=hidden name=id value="${v("id")}">
    <u2-fields>
      Name <input name=name value="${v("name")}"${isNew ? "" : " readonly"} autocomplete=off required>
      Issuer (OIDC) ${text("issuer", "https://accounts.google.com")}
      Client ID ${text("client_id")}
      Client secret <input type=password name=client_secret value="" autocomplete=new-password${isNew ? "" : html.raw(` placeholder="•••••• (unchanged)"`)}>
      Scopes ${text("scopes", "openid email profile")}
      Allowed domains ${text("allowed_domains", "example.com")}
      <div><label><input type=checkbox name=auto_create value=1${checked}> auto-create users</label></div>
    </u2-fields>
    <fieldset>
      <legend>OAuth2 (no discovery)</legend>
      <u2-fields>
        Authorize URL ${text("authorize_url")}
        Token URL ${text("token_url")}
        Userinfo URL ${text("userinfo_url")}
        E-mail URL ${text("email_url")}
      </u2-fields>
    </fieldset>
    <div>
      <button name=oauth_save value=1>${isNew ? "Add" : "Save"}</button>
      ${isNew ? "" : html` <button name=oauth_delete value="${v("id")}" formnovalidate u2-confirm="Delete ${v("name")}?" u2-confirm style="background:var(--red)">Delete</button>`}
    </div>
  </div>
</form>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const db = node.app.db;
  const b = ctx.req.body as Record<string, unknown> | undefined;

  if (b && safeEqual(b.csrfToken, ctx.csrfToken)) {
    if ("oauth_delete" in b) {
      const id = Number(b.oauth_delete);
      const gone = id ? await db.row`SELECT name FROM oauth_provider WHERE id = ${id}` : undefined;
      if (gone) {
        await db.table("oauth_provider").delete(id);
        await db.exec`DELETE FROM oauth_provider_usr WHERE provider = ${gone.name}`; // its links mean nothing without it
      }
    } else if ("oauth_unlink" in b) {
      await db.exec`DELETE FROM oauth_provider_usr WHERE provider = ${String(b.provider ?? "")} AND sub = ${String(b.sub ?? "")}`;
    } else if ("oauth_save" in b) {
      const secret = String(b.client_secret ?? "");
      const vals: Record<string, unknown> = {
        name: String(b.name ?? "").trim(),
        issuer: String(b.issuer ?? "").trim(),
        authorize_url: String(b.authorize_url ?? "").trim(),
        token_url: String(b.token_url ?? "").trim(),
        userinfo_url: String(b.userinfo_url ?? "").trim(),
        email_url: String(b.email_url ?? "").trim(),
        client_id: String(b.client_id ?? "").trim(),
        scopes: String(b.scopes ?? "").trim(),
        auto_create: b.auto_create ? 1 : 0,
        allowed_domains: String(b.allowed_domains ?? "").trim(),
      };
      const id = Number(b.id);
      if (id) { if (secret) vals.client_secret = secret; await db.table("oauth_provider").update(id, vals); }
      else if (vals.name) await db.table("oauth_provider").insert({ client_secret: secret, ...vals });
    }
  }

  const rows = await db.query`SELECT * FROM oauth_provider ORDER BY client_id = '', name`;
  const csrf = ctx.csrfToken;
  const selfBase = ctx.req.url.origin + ctx.req.appUrl;
  const url = ctx.req.url.toURL();
  url.searchParams.delete("auth_oauth_edit");
  const back = url.pathname + url.search;
  const edit = ctx.req.query.auth_oauth_edit;
  const provider = rows.find((r) => String(r.id) === edit);
  if (edit === "new" || provider) return html`<div class=u2-card>
    <div class=-head><a href="${back}">← Back</a> · ${provider?.name ?? "Add provider"}</div>
    ${providerForm(csrf, selfBase, back, provider)}
  </div>`;

  const list = rows.map((r) => {
    url.searchParams.set("auth_oauth_edit", String(r.id));
    return html`<tr u2-href>
      <td><a href="${url.pathname + url.search}">${r.name}</a>
      <td>${r.issuer || r.authorize_url || "—"}
      <td>${r.client_id || "—"}
      <td>${r.scopes || "—"}
      <td>${r.allowed_domains || "All"}
      <td>${Number(r.auto_create) ? "Yes" : "No"}`;
  });
  url.searchParams.set("auth_oauth_edit", "new");

  return html`<div class="u2-flex">
  <div class=u2-card>
    <div class=-head>Login providers (${rows.length})</div>
    <div style="overflow:auto; padding:0">
      <table class=u2-table>
        <thead><tr>
          <th>Provider
          <th>Issuer / Authorize URL
          <th>Client ID
          <th>Scopes
          <th>Allowed domains
          <th>Auto-create users
        <tbody>${list.length ? html.join(list, "\n") : html`<tr><td colspan=6>No providers configured.`}
      </table>
    </div>
    <div><a class=btn href="${url.pathname + url.search}">Add provider</a></div>
  </div>
  ${await links(node.app, csrf)}
</div>`;
}

/** Who is connected to what. The link is what a login follows, so it is the answer to "why does
 *  this account open" — and unlinking here is the only way to break it. */
async function links(app: App, csrf: string): Promise<HtmlString> {
  const rows = await app.db.query`
    SELECT l.provider, l.sub, l.usr_id, l.created, l.last_used, u.username
    FROM oauth_provider_usr l LEFT JOIN usr u ON u.id = l.usr_id
    ORDER BY l.last_used DESC LIMIT 500`;

  const list = rows.map((r) => html`<tr>
    <td>${r.provider}
    <td>${r.username ?? `#${r.usr_id}`}
    <td><code>${r.sub}</code>
    <td>${u2.el.time(r.created)}
    <td>${u2.el.time(r.last_used)}
    <td><form method=post>
      <input type=hidden name=csrfToken value="${csrf}">
      <input type=hidden name=provider value="${r.provider}">
      <input type=hidden name=sub value="${r.sub}">
      <button class=u2-unstyle name=oauth_unlink value=1 u2-confirm="Unlink ${r.username ?? r.provider}?"><u2-ico icon=delete>✕</u2-ico></button>
    </form>`);

  return html`<div class=u2-card style="flex:1 1 100%">
  <div class=-head>Connected accounts (${rows.length})</div>
  <div><small>A login follows the provider's own id, not the e-mail. Unlinking makes the
    next login fall back to matching by verified e-mail again.</small></div>
  <div style="overflow:auto; padding:0">
    <table class=u2-table>
      <thead><tr>
        <th>Provider
        <th>User
        <th>Provider id
        <th>Connected
        <th>Last used
        <th width=60>
      <tbody>${list.length ? html.join(list, "\n") : html`<tr><td colspan=6>Nobody has signed in through a provider yet.`}
    </table>
  </div>
</div>`;
}
