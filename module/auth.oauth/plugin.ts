// deno-lint-ignore-file no-explicit-any
import { Access, addContact, ApiError, contactOwner, getCtx, identified, Output, Redirect, s, unixTime, unb64url, randB64, sha256b64url } from "@qino/qino";
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
  const p = await app.db.row`SELECT * FROM oauth_provider WHERE name = ${name}`;
  if (!p) throw new Output("unknown login provider", { status: 404 });
  return p;
}

/** Distill an id_token / userinfo response into canonical identity fields (providers vary in naming). */
export function identity(c: any): { sub: string; email: string; verified: unknown; firstname: string; lastname: string } {
  const full = String(c.name ?? c.global_name ?? c.username ?? c.login ?? "").trim();
  const [first, ...rest] = full.split(/\s+/);
  return {
    sub: String(c.sub ?? c.id ?? ""), // OIDC calls it sub, plain OAuth2 userinfos usually id
    email: String(c.email ?? "").trim().toLowerCase(),
    verified: c.email_verified ?? c.verified, // may be undefined — that counts as unconfirmed
    firstname: String(c.given_name ?? first ?? ""),
    lastname: String(c.family_name ?? rest.join(" ")),
  };
}

/**
 * Map a distilled identity to a usr id (0 = deny). A remembered `sub` wins: it is the one thing the
 * provider keeps stable, so a changed e-mail on either side no longer moves the account. Whoever is
 * not known yet is matched by verified e-mail, optionally created — and remembered from then on.
 *
 * Coming back to a session that already knows someone means "connect this to me": the link is made
 * for them, and an identity belonging to somebody else is refused rather than silently switching
 * account. That someone is whoever is signed in — or the login parked here waiting for a second
 * factor, which this round trip is answering.
 */
export async function resolveUser(ctx: Ctx, p: any, id: ReturnType<typeof identity>): Promise<number> {
  const db = ctx.app.db;
  const here = identified(ctx);
  // An e-mail off the allowed domains is refused wherever one is given — but a provider that stops
  // sending one (Apple does) must not lock out a link that already exists.
  const domains = String(p.allowed_domains ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (id.email && domains.length && !domains.includes(id.email.split("@")[1] ?? "")) return 0;

  if (id.sub) {
    const link = await db.row`SELECT usr_id FROM oauth_provider_usr WHERE provider = ${p.name} AND sub = ${id.sub}`;
    if (link) {
      const linked = Number(link.usr_id);
      if (here && here !== linked) return 0;
      db.exec`UPDATE oauth_provider_usr SET last_used = ${unixTime()} WHERE provider = ${p.name} AND sub = ${id.sub}`; // background write
      return linked;
    }
  }

  let usrId = here;
  if (!usrId) {
    // Never link/create on an e-mail the provider does not vouch for. A missing claim counts as
    // unconfirmed: a provider whose userinfo mail is editable would otherwise hand over accounts.
    if (!id.email || (id.verified !== true && id.verified !== "true")) return 0;
    // whoever owns the address owns the account — the contact is proven, a login handle is not
    usrId = await contactOwner(db, "email", id.email) ?? 0;
    if (!usrId) {
      if (!p.auto_create) return 0;
      usrId = Number(await db.table("usr").insert({
        email: id.email, active: 1, pw: "", superuser: 0, firstname: id.firstname, lastname: id.lastname,
      }));
    }
  }
  // The provider confirmed the address, which is the same proof a code of ours would be. One that
  // already belongs to somebody else stays theirs — connecting a provider cannot take it over.
  if (id.email && (id.verified === true || id.verified === "true")) await addContact(db, usrId, "email", id.email).catch(() => {});
  if (id.sub) {
    const now = unixTime();
    await db.table("oauth_provider_usr").insert({ provider: p.name, sub: id.sub, usr_id: usrId, created: now, last_used: now });
  }
  return usrId;
}

const CONNECT_TTL = 300;

/** Redirect the browser to the provider's authorization endpoint (OIDC uses code flow + PKCE). */
async function start(ctx: Ctx, name: string): Promise<never> {
  // Signed in, this hands out another way into the account. A route cannot demand a proof (a
  // StepUpError would be a 403 page, not the dialog), so the button calls `connect` first.
  const proved = Number(ctx.sess.data.oauth.proved() ?? 0);
  if (ctx.userId && unixTime() - proved > CONNECT_TTL) throw new Output("connect not confirmed", { status: 403 });

  const p = await provider(ctx.app, name);
  const e = await endpoints(p);
  const state = randB64(24), nonce = randB64(24), verifier = e.oidc ? randB64(48) : "";

  const d = ctx.sess.data.oauth; // one-shot transient, mirrors ctx.sess.data.core.*
  d({}); // spends the mark: the next round trip asks again
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
  // Already this user: the round trip connected a provider, no session to open. A login still owed
  // a factor is parked in the session, and the page we return to asks for it; an empty list means
  // nothing would finish it.
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
