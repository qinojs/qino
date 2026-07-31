// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/mod.ts";
import { hee, type App, type Ctx } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";

export const name = "cms.backend.superuser.oauth";
export const description = "Configures OAuth and OpenID login providers.";
export const needs = ["cms.backend", "oauth"];
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
    if (await app.db.one`SELECT id FROM social_login_provider WHERE name = ${pname}`) continue;
    await app.db.table("social_login_provider").insert({
      name: pname, issuer: def.issuer ?? "", authorize_url: def.authorize_url ?? "", token_url: def.token_url ?? "",
      userinfo_url: def.userinfo_url ?? "", email_url: def.email_url ?? "", client_id: "", client_secret: "",
      scopes: def.scopes, auto_create: 1, allowed_domains: "",
    });
  }
}

/** One editable card per provider (blank `p` = the "add" form). */
function providerForm(csrf: string, selfBase: string, p: any = {}): string {
  const v = (k: string) => hee(p[k]);
  const isNew = !p.id;
  const checked = (isNew || Number(p.auto_create)) ? " checked" : "";
  const text = (k: string, ph = "") => `<input name=${k} value="${v(k)}" placeholder="${hee(ph)}">`;
  return `<form method=post class=u2-card>
  <div class=-head>${isNew ? "Add provider" : v("name")}</div>
  <div class=-body>
    <input type=hidden name=csrfToken value="${hee(csrf)}">
    <input type=hidden name=id value="${v("id")}">
    <u2-fields>
      Name <input name=name value="${v("name")}"${isNew ? "" : " readonly"} required>
      Issuer (OIDC) ${text("issuer", "https://accounts.google.com")}
      Client ID ${text("client_id")}
      Client secret <input type=password name=client_secret value=""${isNew ? "" : ` placeholder="•••••• (unchanged)"`}>
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
    ${isNew ? "" : `<div><small>Redirect URI: <code>${hee(selfBase + "oauth/callback/" + String(p.name))}</code></small></div>`}
    <div><button name=oauth_save value=1>${isNew ? "Add" : "Save"}</button>${isNew ? "" : ` <button name=oauth_delete value="${v("id")}" formnovalidate u2-confirm="Delete ${v("name")}?" class=u2-unstyle>✕</button>`}</div>
  </div>
</form>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  const db = node.app.db;
  const b = ctx.req.body as Record<string, unknown> | undefined;

  if (b?.csrfToken === ctx.csrfToken) {
    if ("oauth_delete" in b) {
      const id = Number(b.oauth_delete);
      if (id) await db.table("social_login_provider").delete(id);
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
      if (id) { if (secret) vals.client_secret = secret; await db.table("social_login_provider").update(id, vals); }
      else if (vals.name) await db.table("social_login_provider").insert({ client_secret: secret, ...vals });
    }
  }

  const rows = await db.query`SELECT * FROM social_login_provider ORDER BY name`;
  const csrf = ctx.csrfToken;
  const selfBase = ctx.req.url.origin + ctx.req.basePath;
  const cards = rows.map((r) => providerForm(csrf, selfBase, r)).join("\n");

  return `<div class=u2-flex>
  ${cards}
  ${providerForm(csrf, selfBase)}
</div>`;
}
