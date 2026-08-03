import { createHash } from "node:crypto";
import { Output, Redirect, b64url, randB64, safeEqual, unixTime, type App, type Ctx } from "../core/mod.ts";
import { consume, mint } from "./lib/tokens.ts";
import { consentPage, errorPage, loginPage } from "./lib/view.ts";

/** OAuth 2.1 authorization server: authorization code + PKCE, public clients, opaque bearer
 *  tokens that authenticate as the qino user who consented. Sign-in reuses the core login
 *  (`core_login`), so the module needs no CMS and no login page of its own. */

const CODE_TTL = 120;
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;

/** Issuer and endpoint base: the mounted app itself, without trailing slash. */
const issuer = (ctx: Ctx) => ctx.req.url.origin + ctx.req.appUrl.replace(/\/$/, "");

const dynamicRegistration = async (app: App) => (await app.settings.oauth_server.dynamicRegistration) !== false;

/** RFC 8414 authorization-server metadata. */
export async function metadata(ctx: Ctx): Promise<Record<string, unknown>> {
  const base = issuer(ctx);
  return {
    issuer: base,
    authorization_endpoint: base + "/authorize",
    token_endpoint: base + "/token",
    ...(await dynamicRegistration(ctx.app) && { registration_endpoint: base + "/register" }),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

/** RFC 9728 protected-resource metadata: this app is its own resource server. */
export function resourceMetadata(ctx: Ctx): Record<string, unknown> {
  const base = issuer(ctx);
  return { resource: base, authorization_servers: [base] };
}

/** Authorization endpoint: authenticate the user, take their consent, hand out a code. */
export async function authorize(ctx: Ctx): Promise<never> {
  const q = ctx.req.query;
  const client = await ctx.app.db.row`SELECT * FROM oauth_client WHERE id = ${String(q.client_id ?? "")}`;
  if (!client) return errorPage(ctx, `Unknown client_id: ${q.client_id ?? ""}`);
  const redirectUri = String(q.redirect_uri ?? "");
  const known = String(client.redirect_uris ?? "").split("\n").filter(Boolean);
  // exact match only (RFC 6749 §3.1.2.3) — no prefix, no wildcard
  if (!known.includes(redirectUri)) return errorPage(ctx, "redirect_uri is not registered for this client");

  // the client is authentic from here on, so protocol errors go back to it instead of dead-ending
  const back = (error: string, description?: string): never => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    if (description) u.searchParams.set("error_description", description);
    if (q.state) u.searchParams.set("state", q.state);
    throw new Redirect(u.href);
  };
  if (q.response_type !== "code") return back("unsupported_response_type");
  if (!q.code_challenge || q.code_challenge_method !== "S256") return back("invalid_request", "PKCE with S256 is required");

  const name = String(client.name || client.id);
  if (!ctx.userId) return loginPage(ctx, name); // core_login on POST logs in before this route runs

  const body = ctx.req.body;
  if (body?.oauth_deny != null) return back("access_denied");
  if (body?.oauth_consent == null) return consentPage(ctx, name, redirectUri);
  if (!safeEqual(body.csrfToken, ctx.csrfToken)) return errorPage(ctx, "Invalid form token — please start over");

  const code = await mint(ctx.app, {
    kind: "code",
    clientId: String(client.id),
    usrId: ctx.userId,
    ttl: CODE_TTL,
    redirectUri,
    challenge: q.code_challenge,
  });
  const u = new URL(redirectUri);
  u.searchParams.set("code", code);
  if (q.state) u.searchParams.set("state", q.state);
  throw new Redirect(u.href);
}

/** Token endpoint: redeem a code (PKCE verified) or rotate a refresh token. Public clients only. */
export async function token(ctx: Ctx): Promise<never> {
  if (ctx.req.method !== "POST") throw fail("invalid_request", "POST required", 405);
  const b = (ctx.req.body ?? {}) as Record<string, unknown>;
  const grant = String(b.grant_type ?? "");
  if (grant === "authorization_code") return issue(ctx, await redeemCode(ctx, b));
  if (grant === "refresh_token") return issue(ctx, await rotate(ctx, b));
  throw fail("unsupported_grant_type", grant);
}

async function redeemCode(ctx: Ctx, b: Record<string, unknown>) {
  const row = await consume(ctx.app, "code", String(b.code ?? "")); // single use, gone either way
  if (!row) throw fail("invalid_grant", "code unknown, expired or already used");
  if (String(row.client_id) !== String(b.client_id ?? "")) throw fail("invalid_grant", "client_id mismatch");
  if (String(row.redirect_uri) !== String(b.redirect_uri ?? "")) throw fail("invalid_grant", "redirect_uri mismatch");
  const verifier = String(b.code_verifier ?? "");
  if (!verifier || !safeEqual(s256(verifier), String(row.challenge))) throw fail("invalid_grant", "PKCE verification failed");
  return row;
}

async function rotate(ctx: Ctx, b: Record<string, unknown>) {
  const row = await consume(ctx.app, "refresh", String(b.refresh_token ?? "")); // rotation: the old one dies here
  if (!row) throw fail("invalid_grant", "refresh token unknown or expired");
  if (b.client_id != null && String(row.client_id) !== String(b.client_id)) throw fail("invalid_grant", "client_id mismatch");
  return row;
}

async function issue(ctx: Ctx, row: Record<string, unknown>): Promise<never> {
  const grant = { clientId: String(row.client_id), usrId: Number(row.usr_id) };
  const [access, refresh] = await Promise.all([
    mint(ctx.app, { ...grant, kind: "access", ttl: ACCESS_TTL }),
    mint(ctx.app, { ...grant, kind: "refresh", ttl: REFRESH_TTL }),
  ]);
  throw new Output({
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
  }, { headers: { "Cache-Control": "no-store" } });
}

/** RFC 7591 dynamic client registration — unauthenticated by design; the trust decision is the
 *  user's consent at `/authorize`, a registration alone grants nothing. */
export async function register(ctx: Ctx): Promise<never> {
  if (!await dynamicRegistration(ctx.app)) throw fail("invalid_request", "dynamic registration is disabled", 403);
  if (ctx.req.method !== "POST") throw fail("invalid_request", "POST required", 405);
  const b = (ctx.req.body ?? {}) as Record<string, unknown>;
  const uris = (Array.isArray(b.redirect_uris) ? b.redirect_uris : []).map(validRedirectUri).filter(Boolean) as string[];
  if (!uris.length) throw fail("invalid_redirect_uri", "need at least one https (or loopback http) redirect_uri");
  if (uris.length > 10) throw fail("invalid_redirect_uri", "too many redirect_uris");
  const id = "c_" + randB64(16);
  const name = String(b.client_name ?? "").slice(0, 191) || id;
  await ctx.app.db.table("oauth_client").insert({ id, name, redirect_uris: uris.join("\n"), created: unixTime() });
  throw new Output({
    client_id: id,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

/** Create or update a client. Returns the redirect_uris that were rejected as unusable. */
export async function saveClient(app: App, c: { id: string; name?: string; redirectUris: string[] }): Promise<string[]> {
  const valid = c.redirectUris.map(validRedirectUri);
  const usable = valid.filter(Boolean);
  if (!usable.length) throw new Error("a client needs at least one usable redirect_uri (https, or http on loopback)");
  const vals = { name: c.name?.trim() || c.id, redirect_uris: usable.join("\n") };
  await app.db.one`SELECT id FROM oauth_client WHERE id = ${c.id}`
    ? await app.db.table("oauth_client").update(c.id, vals)
    : await app.db.table("oauth_client").insert({ id: c.id, ...vals, created: unixTime() });
  return c.redirectUris.filter((_, i) => !valid[i]);
}

/** Remove a client together with every token ever issued to it. */
export async function deleteClient(app: App, id: string): Promise<boolean> {
  await app.db.exec`DELETE FROM oauth_token WHERE client_id = ${id}`;
  return await app.db.table("oauth_client").delete(id);
}

/** Loopback may use http; everything else must be https, and no fragment (RFC 8252). */
function validRedirectUri(raw: unknown): string | undefined {
  const uri = String(raw ?? "");
  let u;
  try { u = new URL(uri); } catch { return; }
  if (u.hash) return;
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) return;
  return uri;
}

const fail = (error: string, description = "", status = 400) =>
  new Output({ error, ...(description && { error_description: description }) }, { status, headers: { "Cache-Control": "no-store" } });

const s256 = (v: string) => b64url(new Uint8Array(createHash("sha256").update(v).digest()));
