// deno-lint-ignore-file no-explicit-any
import { createHmac } from "node:crypto";
import { Access, addContact, ApiError, b64url, contactOwner, getCtx, identified, Output, Redirect, s, safeEqual, unixTime, unb64url, randB64, sha256b64url } from "@qino/qino";
import { proof } from "@qino/qino/auth";

import { links, unlink } from "./mod.ts";

import type { ApiTree, App, Ctx, Params } from "@qino/qino";
import type { Factor } from "@qino/qino/auth";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// No stepUp: the provider answers from its own session, so it says nothing about who is here now.
export const authFactors: Factor[] = [{
  name: "oauth",
  label: "External login",
  has: async (app, usrId) => !!await app.db.one`SELECT 1 FROM oauth_provider_usr WHERE usr_id = ${usrId} LIMIT 1`,
}];

export const api: ApiTree = {
  get: {
    description: "The providers the current user signs in through",
    access: Access.USER,
    execute: async () => {
      const ctx = getCtx();
      const rows = await links(ctx.app, ctx.userId);
      return rows.map((r) => ({ provider: r.provider, sub: r.sub, created: r.created, lastUsed: r.last_used }));
    },
  },

  connect: {
    post: {
      description: "Ask to connect a provider to this account — the round trip that follows needs it",
      access: Access.USER,
      requireStepUp: true,
      execute: () => {
        getCtx().sess.data.oauth.proved(unixTime());
        return { ok: true };
      },
    },
  },

  ":provider": {
    paramSchema: s.string(),
    ":sub": {
      paramSchema: s.string(),
      delete: {
        description: "Disconnect one provider account",
        access: Access.USER,
        requireStepUp: true,
        execute: async ({ provider, sub }: Params) => {
          const ctx = getCtx();
          if (!await unlink(ctx.app, ctx.userId, String(provider), String(sub))) throw new ApiError(404, "Not found");
          return { ok: true };
        },
      },
    },
  },
};

/** Decode a JWT payload without checking the signature — fine here: it comes from the token
 *  endpoint over TLS (allowed by OIDC). */
function jwtPayload(token: string) {
  return JSON.parse(new TextDecoder().decode(unb64url(token.split(".")[1] ?? "")));
}

// public IdP metadata, keyed by issuer — identical across tenants, so a shared cache is safe
const discoveryCache = new Map<string, Promise<any>>();
function discover(issuer: string) {
  let doc = discoveryCache.get(issuer);
  if (!doc) {
    doc = fetch(issuer.replace(/\/$/, "") + "/.well-known/openid-configuration")
      .then((r) => { if (!r.ok) throw new Output("oauth discovery failed", { status: 502 }); return r.json(); });
    doc.catch(() => discoveryCache.delete(issuer)); // never cache a failed lookup
    discoveryCache.set(issuer, doc);
  }
  return doc;
}

/** A provider's endpoints. `authorize_url` set = OAuth2 (identity via userinfo); else OIDC discovery. */
async function endpoints(p: any): Promise<{ authorize: string; token: string; userinfo?: string; issuer?: string; oidc: boolean }> {
  if (p.authorize_url) return { authorize: p.authorize_url, token: p.token_url, userinfo: p.userinfo_url || undefined, oidc: false };
  const m = await discover(p.issuer);
  return { authorize: m.authorization_endpoint, token: m.token_endpoint, userinfo: m.userinfo_endpoint, issuer: m.issuer, oidc: true };
}

/** The client secret. With `key_id` set it is an ES256 JWT, signed with the private key kept in `client_secret`
 *  (Apple: `iss` = Team ID); fresh per exchange, so it never expires on its own. */
export async function clientSecret(p: any, aud: string): Promise<string> {
  if (!p.key_id) return p.client_secret;
  const pkcs8 = Uint8Array.fromBase64(String(p.client_secret).replace(/-----[^-]+-----|\s/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const now = unixTime();
  const data = enc({ alg: "ES256", kid: p.key_id }) + "." +
    enc({ iss: p.team_id || p.client_id, sub: p.client_id, aud, iat: now, exp: now + 300 });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data));
  return data + "." + b64url(new Uint8Array(sig));
}

/** Signature of a relayed state; auth.oauth.relay checks it the same way. */
const stateSig = (key: string, data: string) => createHmac("sha256", key).update(data).digest("base64url").slice(0, 22);

const ownCallback = (ctx: Ctx, name: string) => ctx.req.url.origin + ctx.req.appUrl + "oauth/callback/" + encodeURIComponent(name);
/** Where the provider sends the browser back. A set `redirect_uri` is a shared callback, e.g. auth.oauth.relay. */
const callbackUrl = (ctx: Ctx, p: any): string => p.redirect_uri || ownCallback(ctx, p.name);

/** Only allow local, same-app return targets — blocks open-redirect via ?return_to=. */
const safeReturn = (base: string, raw: unknown) =>
  typeof raw === "string" && /^\/(?![/\\])[^\x00-\x1f]*$/.test(raw) ? raw : base;

async function provider(app: App, name: string): Promise<any> {
  const p = await app.db.row`SELECT * FROM oauth_provider WHERE name = ${name}`;
  if (!p) throw new Output("unknown login provider", { status: 404 });
  return p;
}

/** Normalize an id_token / userinfo response to common identity fields. */
export function identity(c: any): { sub: string; email: string; verified: boolean; given_name: string; family_name: string } {
  const full = String(c.name ?? c.global_name ?? c.username ?? c.login ?? "").trim();
  const [first, ...rest] = full.split(/\s+/);
  return {
    sub: String(c.sub ?? c.id ?? ""), // OIDC calls it sub, plain OAuth2 userinfos usually id
    email: String(c.email ?? "").trim().toLowerCase(),
    // missing counts as unconfirmed; Microsoft sends the optional claim xms_edov instead
    verified: String(c.email_verified ?? c.verified ?? c.xms_edov) === "true",
    given_name: String(c.given_name ?? first ?? ""),
    family_name: String(c.family_name ?? rest.join(" ")),
  };
}

/**
 * Map an identity to a usr id (0 = deny). A saved `sub` wins (stable, unlike the e-mail). Unknown
 * identities are matched by verified e-mail, optionally created, then linked.
 *
 * With a signed-in user it means "connect to me": linked to that user; an identity of another user
 * is refused. A pending login (second factor) only accepts an existing link.
 */
export async function resolveUser(ctx: Ctx, p: any, id: ReturnType<typeof identity>): Promise<number> {
  const db = ctx.app.db;
  const here = identified(ctx);
  // Refuse e-mails outside the allowed domains — but without an e-mail (Apple) keep existing links.
  const domains = String(p.allowed_domains ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (id.email && domains.length && !domains.includes(id.email.split("@")[1] ?? "")) return 0;

  if (id.sub) {
    const link = await db.row`SELECT usr_id FROM oauth_provider_usr WHERE provider = ${p.name} AND sub = ${id.sub}`;
    if (link) {
      const linked = Number(link.usr_id);
      if (here && here !== linked) return 0;
      db.exec`UPDATE oauth_provider_usr SET last_used = ${unixTime()} WHERE provider = ${p.name} AND sub = ${id.sub}`.catch(() => {}); // background write
      return linked;
    }
  }

  // A pending login only accepts an existing link; otherwise a password holder could connect their
  // own provider account as second factor. Connecting needs a session.
  if (here && !ctx.userId) return 0;
  let usrId = ctx.userId;
  // `trust_email`: the provider only hands out confirmed addresses but doesn't say so (Facebook) — good
  // enough for a new account, never to enter an existing one
  const trusted = !id.verified && !!Number(p.trust_email ?? 0);
  if (!usrId) {
    // Only verified e-mails; a missing claim counts as unverified (editable provider e-mails would
    // otherwise allow takeovers).
    if (!id.email || !(id.verified || trusted)) return 0;
    // whoever owns the address owns the account — the contact is proven, a login handle is not
    usrId = await contactOwner(db, "email", id.email) ?? 0;
    if (usrId && trusted) return 0;
    if (!usrId) {
      // a taken login handle is someone's account: they sign in and connect, nobody gets a twin
      if (!p.auto_create || await db.one`SELECT id FROM usr WHERE LOWER(TRIM(username)) = ${id.email}`) return 0;
      usrId = Number(await db.table("usr").insert({
        username: id.email, active: 1, pw: "", superuser: 0, given_name: id.given_name, family_name: id.family_name,
      }));
    }
  }
  // A provider-verified address counts like our own verification; addresses of other users stay theirs.
  if (id.email && (id.verified || trusted && !ctx.userId)) await addContact(db, usrId, "email", id.email).catch(() => {});
  if (id.sub) {
    const now = unixTime();
    await db.table("oauth_provider_usr").insert({ provider: p.name, sub: id.sub, usr_id: usrId, created: now, last_used: now });
  }
  return usrId;
}

const CONNECT_TTL = 300;

/** Redirect the browser to the provider's authorization endpoint (OIDC uses code flow + PKCE). */
async function start(ctx: Ctx, name: string): Promise<never> {
  // Signed in, this adds a way into the account. Routes can't require a step-up (it would be a 403
  // page), so the button calls `connect` first.
  const proved = Number(ctx.sess.data.oauth.proved() ?? 0);
  if (ctx.userId && unixTime() - proved > CONNECT_TTL) throw new Output("connect not confirmed", { status: 403 });

  const p = await provider(ctx.app, name);
  const e = await endpoints(p);
  const own = ownCallback(ctx, name), redirectUri = callbackUrl(ctx, p);
  // a shared callback learns from the state where to send the browser on; signed with the client secret,
  // so a relay that knows it trusts the target without a host list
  const rnd = randB64(24), target = b64url(new TextEncoder().encode(own));
  const sig = stateSig(String(p.client_secret).trim(), `${rnd}.${target}`);
  const state = redirectUri === own ? rnd : `${rnd}.${target}.${sig}`;
  const nonce = randB64(24), verifier = e.oidc ? randB64(48) : "";

  // one-shot, for the callback; replacing the whole value also spends the `connect` mark
  ctx.sess.data.oauth({ prov: name, state, nonce, verifier, returnTo: safeReturn(ctx.req.appUrl, ctx.req.query.return_to) });

  const u = new URL(e.authorize);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.client_id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", p.scopes || "openid email profile");
  u.searchParams.set("state", state);
  if (p.response_mode) u.searchParams.set("response_mode", p.response_mode); // e.g. form_post (Apple)
  if (e.oidc) { // PKCE + nonce only for OIDC; plain-OAuth2 providers (e.g. GitHub) may reject them
    u.searchParams.set("nonce", nonce);
    u.searchParams.set("code_challenge", await sha256b64url(verifier));
    u.searchParams.set("code_challenge_method", "S256");
  }
  throw new Redirect(u.href);
}

/** Provider redirect back: exchange the code, obtain identity (id_token or userinfo), log in. */
async function callback(ctx: Ctx, name: string): Promise<never> {
  // form_post: a cross-site POST carries no SameSite=Lax session cookie, so come back as a GET
  if (ctx.req.method === "POST") {
    const u = ctx.req.url.toURL();
    for (const [k, v] of Object.entries(ctx.req.body ?? {})) u.searchParams.set(k, String(v));
    throw new Redirect(u.href, 303);
  }
  const q = ctx.req.query;
  const { prov, state, nonce, verifier, returnTo } = (ctx.sess.data.oauth() ?? {}) as Record<string, string>;
  ctx.sess.data.oauth({}); // spent whatever the outcome
  if (prov !== name || !state || !q.code || !safeEqual(q.state, state)) throw new Output("oauth state mismatch", { status: 400 });

  const p = await provider(ctx.app, name);
  const e = await endpoints(p);

  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code: q.code,
    redirect_uri: callbackUrl(ctx, p),
    client_id: p.client_id,
    client_secret: await clientSecret(p, e.issuer ?? p.issuer),
    ...(verifier && { code_verifier: verifier }),
  };
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
    // a multi-tenant issuer (Microsoft "common") names the user's tenant: .../{tenantid}/v2.0
    const issuer = String(e.issuer ?? p.issuer).replace("{tenantid}", String(claims.tid ?? ""));
    const issOk = String(claims.iss ?? "").replace(/\/$/, "") === issuer.replace(/\/$/, "");
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
  // Same user: a provider was connected, no new session. A missing factor is asked for on the return
  // page; an empty list means the login can't be finished.
  const missing = usrId && usrId !== ctx.userId ? await proof(ctx, "oauth", usrId) : undefined;
  if (!usrId || missing?.length === 0) throw new Output("oauth login denied", { status: 403 });
  throw new Redirect(safeReturn(ctx.req.appUrl, returnTo));
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => {
    const path = ctx.req.appPath;
    if (path.startsWith("oauth/start/")) return start(ctx, path.slice("oauth/start/".length));
    if (path.startsWith("oauth/callback/")) return callback(ctx, path.slice("oauth/callback/".length));
  }, { signal });
}
