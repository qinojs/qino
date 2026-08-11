// deno-lint-ignore-file no-explicit-any
import dbSchema from "./dbschema.json" with { type: "json" };
import { login, Output, Redirect, unixTime, unb64url, randB64, sha256b64url, type App, type Ctx } from "../core/mod.ts";

export { dbSchema };

/** Decode a JWT payload without verifying the signature — safe here: the token comes
 *  straight from the token endpoint over TLS (OIDC allows skipping the signature check). */
function jwtPayload(token: string): any {
  return JSON.parse(new TextDecoder().decode(unb64url(token.split(".")[1] ?? "")));
}

// public IdP metadata, keyed by issuer — identical across tenants, so a shared cache is safe
const discoveryCache = new Map<string, Promise<any>>();
function discover(issuer: string): Promise<any> {
  let doc = discoveryCache.get(issuer);
  if (!doc) {
    doc = fetch(issuer.replace(/\/$/, "") + "/.well-known/openid-configuration")
      .then((r) => { if (!r.ok) throw new Output("oauth discovery failed", { status: 502 }); return r.json(); });
    doc.catch(() => discoveryCache.delete(issuer)); // never cache a failed lookup
    discoveryCache.set(issuer, doc);
  }
  return doc;
}

/** Endpoints for a provider. Explicit `authorize_url` = plain OAuth2 (no id_token, identity via
 *  userinfo); otherwise standard OIDC discovery over the issuer. */
async function endpoints(p: any): Promise<{ authorize: string; token: string; userinfo?: string; oidc: boolean }> {
  if (p.authorize_url) return { authorize: p.authorize_url, token: p.token_url, userinfo: p.userinfo_url || undefined, oidc: false };
  const m = await discover(p.issuer);
  return { authorize: m.authorization_endpoint, token: m.token_endpoint, userinfo: m.userinfo_endpoint, oidc: true };
}

const callbackUrl = (ctx: Ctx, name: string): string => ctx.req.url.origin + ctx.req.appUrl + "oauth/callback/" + encodeURIComponent(name);

/** Only allow local, same-app return targets — blocks open-redirect via ?return_to=. */
const safeReturn = (base: string, raw: unknown): string =>
  typeof raw === "string" && /^\/(?![/\\])/.test(raw) ? raw : base;

async function provider(app: App, name: string): Promise<any> {
  const p = await app.db.row`SELECT * FROM social_login_provider WHERE name = ${name}`;
  if (!p) throw new Output("unknown login provider", { status: 404 });
  return p;
}

/** Distill an id_token / userinfo response into canonical identity fields (providers vary in naming). */
function identity(c: any): { email: string; verified: unknown; firstname: string; lastname: string } {
  const full = String(c.name ?? c.global_name ?? c.username ?? c.login ?? "").trim();
  const [first, ...rest] = full.split(/\s+/);
  return {
    email: String(c.email ?? "").trim().toLowerCase(),
    verified: c.email_verified ?? c.verified, // may be undefined — many OAuth2 userinfos omit it
    firstname: String(c.given_name ?? first ?? ""),
    lastname: String(c.family_name ?? rest.join(" ")),
  };
}

/** Map a distilled identity to a usr id (0 = deny). Links by e-mail, optionally auto-creates. */
async function resolveUser(ctx: Ctx, p: any, id: ReturnType<typeof identity>): Promise<number> {
  if (!id.email || id.verified === false) return 0; // never link/create on an unverified e-mail
  const domains = String(p.allowed_domains ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (domains.length && !domains.includes(id.email.split("@")[1])) return 0;
  const existing = await ctx.app.db.one`SELECT id FROM usr WHERE LOWER(TRIM(email)) = ${id.email}`;
  if (existing) return Number(existing);
  if (!p.auto_create) return 0;
  return Number(await ctx.app.db.table("usr").insert({
    email: id.email, active: 1, pw: "", superuser: 0, firstname: id.firstname, lastname: id.lastname,
  }));
}

/** Redirect the browser to the provider's authorization endpoint (OIDC uses code flow + PKCE). */
async function start(ctx: Ctx, name: string): Promise<never> {
  const p = await provider(ctx.app, name);
  const e = await endpoints(p);
  const state = randB64(24), nonce = randB64(24), verifier = e.oidc ? randB64(48) : "";

  const d = ctx.sess.data.oauth; // one-shot transient, mirrors ctx.sess.data.core.*
  d.prov(name); d.state(state); d.nonce(nonce); d.verifier(verifier);
  d.returnTo(safeReturn(ctx.req.appUrl, ctx.req.query.return_to));

  const u = new URL(e.authorize);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.client_id);
  u.searchParams.set("redirect_uri", callbackUrl(ctx, name));
  u.searchParams.set("scope", p.scopes || "openid email profile");
  u.searchParams.set("state", state);
  if (e.oidc) { // PKCE + nonce only for OIDC; plain-OAuth2 providers (e.g. GitHub) may reject them
    u.searchParams.set("nonce", nonce);
    u.searchParams.set("code_challenge", await sha256b64url(verifier));
    u.searchParams.set("code_challenge_method", "S256");
  }
  throw new Redirect(u.href);
}

/** Provider redirect back: exchange the code, obtain identity (id_token or userinfo), log in. */
async function callback(ctx: Ctx, name: string): Promise<never> {
  const q = ctx.req.query;
  const d = ctx.sess.data.oauth;
  const savedProv = String(d.prov() ?? ""), state = String(d.state() ?? ""), nonce = String(d.nonce() ?? ""), verifier = String(d.verifier() ?? ""), returnTo = String(d.returnTo() ?? "");
  d({}); // consume the transient regardless of outcome
  if (savedProv !== name || !state || !q.code || q.state !== state) throw new Output("oauth state mismatch", { status: 400 });

  const p = await provider(ctx.app, name);
  const e = await endpoints(p);

  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code: q.code,
    redirect_uri: callbackUrl(ctx, name),
    client_id: p.client_id,
    client_secret: p.client_secret,
  };
  if (verifier) form.code_verifier = verifier;
  const res = await fetch(e.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("oauth token exchange failed:", name, res.status, tok?.error ?? ""); throw new Output("oauth token exchange failed", { status: 502 }); }

  let claims: any;
  if (tok.id_token) { // OIDC — validate the id_token
    claims = jwtPayload(tok.id_token);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const issOk = String(claims.iss ?? "").replace(/\/$/, "") === String(p.issuer).replace(/\/$/, "");
    if (!issOk || !aud.includes(p.client_id) || claims.nonce !== nonce || (claims.exp && claims.exp < unixTime()))
      throw new Output("oauth token invalid", { status: 400 });
  } else if (e.userinfo && tok.access_token) { // plain OAuth2 — identity from the userinfo endpoint
    const bearer = { authorization: "Bearer " + tok.access_token, accept: "application/json", "user-agent": "qino" };
    claims = await fetch(e.userinfo, { headers: bearer }).then((r) => r.json()).catch(() => ({}));
    if (!claims.email && p.email_url) { // e.g. GitHub returns the primary e-mail from a separate endpoint
      const list = await fetch(p.email_url, { headers: bearer }).then((r) => r.json()).catch(() => []);
      const primary = Array.isArray(list) ? list.find((m) => m.primary && m.verified) : null;
      if (primary) { claims.email = primary.email; claims.email_verified = true; }
    }
  } else {
    throw new Output("oauth token exchange failed", { status: 502 });
  }

  const usrId = await resolveUser(ctx, p, identity(claims));
  if (!usrId || !await login(ctx, usrId)) throw new Output("oauth login denied", { status: 403 });
  throw new Redirect(safeReturn(ctx.req.appUrl, returnTo));
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    const path = ctx.req.appPath;
    if (path.startsWith("oauth/start/")) await start(ctx, path.slice("oauth/start/".length));
    else if (path.startsWith("oauth/callback/")) await callback(ctx, path.slice("oauth/callback/".length));
  }, { signal });
}
