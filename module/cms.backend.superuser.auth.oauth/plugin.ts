// deno-lint-ignore-file no-explicit-any
import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const cms = { node: { render } };

type Preset = { issuer?: string; scopes: string; authorize_url?: string; token_url?: string; userinfo_url?: string; email_url?: string };

// Well-known providers, seeded on install; the admin only adds client_id/secret.
// OIDC = issuer (discovery). OAuth2 = explicit endpoints. Replace <tenant> with your own domain.
const PRESETS: Record<string, Preset> = {
  google:    { issuer: "https://accounts.google.com", scopes: "openid email profile" },
  microsoft: { issuer: "https://login.microsoftonline.com/<tenant>/v2.0", scopes: "openid email profile" },
  apple:     { issuer: "https://appleid.apple.com", scopes: "openid email name" },
  auth0:     { issuer: "https://<tenant>.auth0.com", scopes: "openid email profile" },
  gitlab:    { issuer: "https://gitlab.com", scopes: "openid email profile" },
  linkedin:  { issuer: "https://www.linkedin.com/oauth", scopes: "openid email profile" },
  slack:     { issuer: "https://slack.com", scopes: "openid email profile" },
  github:    { scopes: "read:user user:email", authorize_url: "https://github.com/login/oauth/authorize", token_url: "https://github.com/login/oauth/access_token", userinfo_url: "https://api.github.com/user", email_url: "https://api.github.com/user/emails" },
  discord:   { scopes: "identify email", authorize_url: "https://discord.com/oauth2/authorize", token_url: "https://discord.com/api/oauth2/token", userinfo_url: "https://discord.com/api/users/@me" },
};

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Social login", de: "Social-Login" });
  for (const [pname, def] of Object.entries(PRESETS)) {
    if (await app.db.one`SELECT id FROM oauth_provider WHERE name = ${pname}`) continue;
    await app.db.table("oauth_provider").insert({
      name: pname, issuer: def.issuer ?? "", authorize_url: def.authorize_url ?? "", token_url: def.token_url ?? "",
      userinfo_url: def.userinfo_url ?? "", email_url: def.email_url ?? "", client_id: "", client_secret: "",
      scopes: def.scopes, auto_create: 1, allowed_domains: "",
    });
  }
}

/** One editable card per provider (blank `p` = the "add" form). */
function providerForm(csrf: string, selfBase: string, p: any = {}): HtmlString {
  const v = (k: string) => p[k];
  const isNew = !p.id;
  const checked = (isNew || Number(p.auto_create)) ? " checked" : "";
  const text = (k: string, ph = "") => html`<input name=${k} value="${v(k)}" placeholder="${ph}" autocomplete=off>`;
  // autocomplete: a password field makes the browser read the whole form as a login and offer the
  // saved one; `new-password` says this is not that form.
  return html`<form method=post class=u2-card autocomplete=off>
  <div class=-head>${isNew ? "Add provider" : v("name")}</div>
  <div class=-body>
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
    <details>
      <summary>OAuth2 (no discovery)</summary>
      <u2-fields>
        Authorize URL ${text("authorize_url")}
        Token URL ${text("token_url")}
        Userinfo URL ${text("userinfo_url")}
        E-mail URL ${text("email_url")}
      </u2-fields>
    </details>
    ${isNew ? "" : html`<div><small>Redirect URI: <code>${selfBase + "oauth/callback/" + String(p.name)}</code></small></div>`}
    <div><button name=oauth_save value=1>${isNew ? "Add" : "Save"}</button>${isNew ? "" : html` <button name=oauth_delete value="${v("id")}" formnovalidate u2-confirm="Delete ${v("name")}?" class=u2-unstyle>✕</button>`}</div>
  </div>
</form>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const db = node.app.db;
  const b = ctx.req.body as Record<string, unknown> | undefined;

  if (b?.csrfToken === ctx.csrfToken) {
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

  const rows = await db.query`SELECT * FROM oauth_provider ORDER BY name`;
  const csrf = ctx.csrfToken;
  const selfBase = ctx.req.url.origin + ctx.req.appUrl;
  const cards = rows.map((r) => providerForm(csrf, selfBase, r));

  return html`<div class=u2-flex>
  ${html.join(cards, "\n")}
  ${providerForm(csrf, selfBase)}
  ${await links(node.app, csrf)}
</div>`;
}

/** Who is connected to what. The link is what a login follows, so it is the answer to "why does
 *  this account open" — and unlinking here is the only way to break it. */
async function links(app: App, csrf: string): Promise<HtmlString> {
  const rows = await app.db.query`
    SELECT l.provider, l.sub, l.usr_id, l.created, l.last_used, u.email
    FROM oauth_provider_usr l LEFT JOIN usr u ON u.id = l.usr_id
    ORDER BY l.last_used DESC LIMIT 500`;

  const when = (at: unknown) => at ? html`<u2-time datetime="${new Date(Number(at) * 1000).toISOString()}" type=relative></u2-time>` : "—";
  const list = rows.map((r) => html`<tr>
    <td>${r.provider}
    <td>${r.email ?? `#${r.usr_id}`}
    <td><code>${r.sub}</code>
    <td>${when(r.created)}
    <td>${when(r.last_used)}
    <td><form method=post>
      <input type=hidden name=csrfToken value="${csrf}">
      <input type=hidden name=provider value="${r.provider}">
      <input type=hidden name=sub value="${r.sub}">
      <button class=u2-unstyle name=oauth_unlink value=1 u2-confirm="Unlink ${r.email ?? r.provider}?"><u2-ico icon=delete>✕</u2-ico></button>
    </form>`);

  return html`<div class=u2-card style="flex:1 1 100%">
  <div class=-head>Connected accounts (${rows.length})</div>
  <div class=-body><small>A login follows the provider's own id, not the e-mail. Unlinking makes the
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
      <tbody>${list.length ? html.join(list, "\n") : html`<tr><td colspan=6>Nobody has signed in through a provider yet.`}</tbody>
    </table>
  </div>
</div>`;
}
