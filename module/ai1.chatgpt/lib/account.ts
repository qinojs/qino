import { AiError } from "@qino/qino/ai1";
import { fs, randB64, sha256b64url, unb64url } from "@qino/qino";

import { syncModels } from "./provider.ts";

import type { App } from "@qino/qino";

export type Account = {
  client_id: string;
  subject: string;
  email: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  scopes: string[];
  expires_at: number;
};
type Accounts = { active?: string; accounts: Account[] };
export type Pending = { state: string; nonce: string; verifier: string; client_id: string; redirect_uri: string; return_to: string; user: number; time: number };

const AUTH = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";

const dir = (app: App) => app.modules.get("ai1.chatgpt")!.data;
const path = (app: App, user: number) => `${dir(app)}user-${user}.json`;

/** Credentials in owner-only files, written atomically, as OpenAI's sign-in contract requires
 *  (https://developers.openai.com/siwc/token-sharing-open-source/sign-in) — not in the database. */
async function atomic(path: string, value: unknown): Promise<void> {
  await fs.mkdir(path.slice(0, path.lastIndexOf("/") + 1), { mode: 0o700 });
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.write(tmp, JSON.stringify(value), { createNew: true, mode: 0o600 });
    await fs.rename(tmp, path);
  } finally {
    await fs.remove(tmp);
  }
}

/** A stable host ID belongs to the app installation, never to a browser session. */
export async function hostId(app: App): Promise<string> {
  const file = `${dir(app)}host.json`;
  if (await fs.isFile(file)) return String(JSON.parse(await fs.text(file)).id);
  const id = `urn:uuid:${crypto.randomUUID()}`;
  await atomic(file, { id });
  return id;
}

export async function accounts(app: App, user: number): Promise<Accounts> {
  const file = path(app, user);
  return await fs.isFile(file) ? JSON.parse(await fs.text(file)) : { accounts: [] };
}

/** Public account summary for user interfaces; credentials stay inside this module. */
export async function connections(app: App, user: number): Promise<{ clientId: string; label: string; active: boolean }[]> {
  const value = await accounts(app, user);
  return value.accounts.map((a) => ({ clientId: a.client_id, label: a.email || a.subject, active: a.client_id === value.active }));
}

async function save(app: App, user: number, value: Accounts): Promise<void> {
  await atomic(path(app, user), value);
}

export async function store(app: App, user: number, account: Account): Promise<void> {
  const value = await accounts(app, user);
  value.accounts = [...value.accounts.filter((a) => a.client_id !== account.client_id), account];
  value.active = account.client_id;
  await save(app, user, value);
}

export async function remove(app: App, user: number, clientId: string): Promise<void> {
  const value = await accounts(app, user);
  value.accounts = value.accounts.filter((a) => a.client_id !== clientId);
  if (value.active === clientId) value.active = value.accounts[0]?.client_id;
  await save(app, user, value);
}

export async function select(app: App, user: number, clientId: string): Promise<void> {
  const value = await accounts(app, user);
  if (!value.accounts.some((a) => a.client_id === clientId)) throw new AiError("Unknown ChatGPT account", 404);
  value.active = clientId;
  await save(app, user, value);
}

export async function authorize(p: Pending, host: string, name: string, hint?: Account): Promise<string> {
  const url = new URL(AUTH + "/api/accounts/authorize");
  const params = url.searchParams;
  params.set("client_id", p.client_id);
  params.set("response_type", "code");
  params.set("redirect_uri", p.redirect_uri);
  params.set("scope", `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`);
  params.set("resource", RESOURCE);
  params.set("state", p.state);
  params.set("nonce", p.nonce);
  params.set("code_challenge_method", "S256");
  params.set("code_challenge", await sha256b64url(p.verifier));
  params.set("ext_agent_host_id", host);
  if (hint) { params.set("id_token_hint", hint.id_token); params.set("login_hint", hint.email); }
  else params.set("agent_name_hint", name);
  return url.href;
}

export function pending(user: number, clientId: string, redirectUri: string, returnTo: string): Pending {
  const verifier = randB64(48);
  return { state: randB64(24), nonce: randB64(24), verifier, client_id: clientId, redirect_uri: redirectUri, return_to: returnTo, user, time: Date.now() };
}

async function token(body: URLSearchParams): Promise<Record<string, unknown>> {
  const res = await fetch(AUTH + "/api/accounts/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new AiError(`ChatGPT authorization failed (HTTP ${res.status})`, res.status);
  return await res.json();
}

function claims(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(unb64url(part)));
}

/** Verify signature and the OIDC claims before associating credentials with a Qino user. */
async function verify(idToken: string, clientId: string, nonce: string): Promise<{ subject: string; email: string }> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new AiError("Invalid ChatGPT identity token", 400);
  const head = claims(parts[0]), body = claims(parts[1]);
  const alg = head.alg;
  if (alg !== "RS256" && alg !== "ES256") throw new AiError("Unsupported ChatGPT identity signature", 400);
  const discovery = await fetch(AUTH + "/.well-known/openid-configuration").then((r) => r.json());
  const jwksUrl = String(discovery.jwks_uri ?? "");
  if (new URL(jwksUrl).origin !== AUTH) throw new AiError("Invalid ChatGPT key endpoint", 400);
  const jwks = await fetch(jwksUrl).then((r) => r.json());
  const jwk = jwks.keys?.find((k: JsonWebKey & { kid?: string }) => k.kid === head.kid && k.alg === alg);
  if (!jwk) throw new AiError("ChatGPT identity key was not found", 400);
  const algorithm = alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" };
  const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
  const check = alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" };
  const valid = await crypto.subtle.verify(check, key, unb64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  const now = Date.now() / 1000;
  if (!valid || body.iss !== AUTH || !aud.includes(clientId) || body.nonce !== nonce || typeof body.sub !== "string" || !body.sub ||
    typeof body.exp !== "number" || body.exp < now - 5 || typeof body.iat !== "number" || body.iat > now + 5)
    throw new AiError("ChatGPT identity verification failed", 400);
  return { subject: body.sub, email: String(body.email ?? "") };
}

export async function exchange(p: Pending, code: string, returnedClientId?: string, previous?: Account): Promise<Account> {
  const clientId = p.client_id === "dynamic_agent_client" ? returnedClientId : p.client_id;
  if (!clientId || !/^oaiapp_[\w-]+$/.test(clientId) || returnedClientId && returnedClientId !== clientId)
    throw new AiError("Invalid ChatGPT client registration", 400);
  const result = await token(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: p.verifier, redirect_uri: p.redirect_uri, resource: RESOURCE }));
  const identity = await verify(String(result.id_token ?? ""), clientId, p.nonce);
  if (previous && previous.subject !== identity.subject) throw new AiError("A different ChatGPT account answered", 400);
  const scopes = String(result.scope ?? "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(PLAN_SCOPE) || typeof result.access_token !== "string" || typeof result.refresh_token !== "string")
    throw new AiError("ChatGPT plan usage was not granted", 403);
  return { client_id: clientId, ...identity, id_token: String(result.id_token), access_token: result.access_token,
    refresh_token: result.refresh_token, scopes, expires_at: Date.now() + Number(result.expires_in ?? 3600) * 1000 };
}

const refreshing = new WeakMap<App, Map<string, Promise<Account>>>();

/** Refresh is serialized for each account in one local Qino process. */
export async function active(app: App, user: number): Promise<Account | undefined> {
  const value = await accounts(app, user);
  const account = value.accounts.find((a) => a.client_id === value.active);
  if (!account || account.expires_at > Date.now() + 60_000) return account;
  const locks = refreshing.get(app) ?? refreshing.set(app, new Map()).get(app)!;
  const key = `${user}:${account.client_id}`;
  let task = locks.get(key);
  if (!task) {
    task = (async () => {
      const current = (await accounts(app, user)).accounts.find((a) => a.client_id === account.client_id)!;
      if (current.expires_at > Date.now() + 60_000) return current;
      const result = await token(new URLSearchParams({ grant_type: "refresh_token", client_id: current.client_id,
        refresh_token: current.refresh_token, resource: RESOURCE }));
      if (typeof result.access_token !== "string" || typeof result.refresh_token !== "string")
        throw new AiError("ChatGPT token refresh failed", 401);
      const scopes = String(result.scope ?? "").split(/\s+/).filter(Boolean);
      if (!scopes.includes(PLAN_SCOPE)) throw new AiError("ChatGPT plan usage is no longer granted", 403);
      const refreshed = { ...current, access_token: result.access_token, refresh_token: result.refresh_token,
        scopes, expires_at: Date.now() + Number(result.expires_in ?? 3600) * 1000 };
      const next = await accounts(app, user);
      next.accounts = next.accounts.map((a) => a.client_id === refreshed.client_id ? refreshed : a);
      await save(app, user, next);
      return refreshed;
    })().finally(() => locks.delete(key));
    locks.set(key, task);
  }
  return await task;
}

export async function revoke(account: Account): Promise<void> {
  const discovery = await fetch(AUTH + "/.well-known/openid-configuration").then((r) => r.json());
  const url = String(discovery.revocation_endpoint ?? "");
  if (new URL(url).origin !== AUTH) throw new AiError("Invalid ChatGPT revocation endpoint", 400);
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: account.refresh_token, token_type_hint: "refresh_token", client_id: account.client_id }) });
  if (!res.ok) throw new AiError(`ChatGPT sign-out was not confirmed (HTTP ${res.status})`, res.status);
}

/** The account's plan-compatible model slugs, added to ai1 when listed. */
export async function models(app: App, user: number): Promise<string[]> {
  const account = await active(app, user);
  if (!account) return [];
  const res = await fetch(RESOURCE + "/models", { headers: { authorization: `Bearer ${account.access_token}` } });
  if (!res.ok) throw new AiError(`ChatGPT model catalog failed (HTTP ${res.status})`, res.status);
  const catalog = await res.json();
  const names: string[] = Array.isArray(catalog.models) ? catalog.models.filter((m: { visibility?: string }) => m.visibility === "list")
    .map((m: { slug?: unknown }) => m.slug).filter((slug: unknown): slug is string => typeof slug === "string") : [];
  await syncModels(app, names);
  return names;
}
