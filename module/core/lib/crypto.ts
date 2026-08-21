import { createHmac, timingSafeEqual } from "node:crypto";

import { unixTime } from "./util.ts";

import type { App } from "./App.ts";
import type { Session } from "./SessionManager.ts";

const ENCODER = new TextEncoder();
const TTL = 4 * 3600;
const SIGNATURE_LENGTH = 22;

/** base64url (RFC 4648) — no padding, URL-safe alphabet. */
export const b64url = (bytes: Uint8Array): string => bytes.toBase64({ alphabet: "base64url", omitPadding: true });
export const unb64url = (str: string): Uint8Array<ArrayBuffer> => Uint8Array.fromBase64(str, { alphabet: "base64url" });

/** n random bytes as base64url. */
export const randB64 = (n: number): string => b64url(crypto.getRandomValues(new Uint8Array(n)));

const digest = async (str: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", ENCODER.encode(str)));

/** SHA-256 of a string as base64 — 44 chars. What CSP hash-sources and SRI `integrity` expect. */
export const sha256b64 = async (str: string): Promise<string> => (await digest(str)).toBase64();

/** SHA-256 as base64url — 43 chars, safe as a column key or URL parameter. Required for PKCE. */
export const sha256b64url = async (str: string): Promise<string> => b64url(await digest(str));

export const uid = (length?: number): string => randB64(16).slice(0, length);

/** Constant-time token compare (CSRF etc.); coerces untrusted input to string. */
export function safeEqual(a: unknown, b: string): boolean {
  const ab = ENCODER.encode(String(a ?? "")), bb = ENCODER.encode(b);
  return ab.byteLength === bb.byteLength && timingSafeEqual(ab, bb);
}

type Params = { exp?: unknown; sig?: unknown };
type SessionState = "ok" | "expired" | "forged" | "unsigned";
type PermanentState = "ok" | "forged" | "unsigned";

function sign(sess: Session, resource: string, options?: { ttl?: number }): { exp: string; sig: string };
function sign(app: App, resource: string): Promise<{ sig: string }>;
function sign(owner: Session | App, resource: string, options: { ttl?: number } = {}) {
  if (!isSession(owner)) return appSecret(owner).then(secret => ({ sig: mac(secret, resource) }));
  const exp = unixTime() + (options.ttl ?? TTL);
  return { exp: String(exp), sig: mac(sessionSecret(owner), resource, exp) };
}

function verify(sess: Session, resource: string, params: Params): SessionState;
function verify(app: App, resource: string, params: Params): Promise<PermanentState>;
function verify(owner: Session | App, resource: string, params: Params): SessionState | Promise<PermanentState> {
  return isSession(owner) ? verifySession(owner, resource, params) : verifyPermanent(owner, resource, params);
}

export const grant = { sign, verify };

function isSession(owner: Session | App): owner is Session {
  return "data" in owner;
}

function sessionSecret(sess: Session): string {
  const item = sess.data.core.grantKey;
  let value = String(item() ?? "");
  if (!value) item(value = uid());
  return value;
}

function verifySession(sess: Session, resource: string, { exp, sig }: Params): SessionState {
  const raw = String(exp ?? ""), given = String(sig ?? "");
  if (!raw && !given) return "unsigned";
  if (!/^\d{1,12}$/.test(raw) || !safeEqual(given, mac(sessionSecret(sess), resource, Number(raw)))) return "forged";
  return Number(raw) < unixTime() ? "expired" : "ok";
}

async function verifyPermanent(app: App, resource: string, { sig }: Params): Promise<PermanentState> {
  const given = String(sig ?? "");
  if (!given) return "unsigned";
  return safeEqual(given, mac(await appSecret(app), resource)) ? "ok" : "forged";
}

async function appSecret(app: App): Promise<string> {
  const secret = String(await app.settings.core._secret ?? "");
  if (!secret) throw new Error("Core secret is not initialized");
  return secret;
}

function mac(secret: string, resource: string, exp?: number): string {
  return createHmac("sha256", secret).update(exp === undefined ? resource : `${resource}\0${exp}`)
    .digest("base64url").slice(0, SIGNATURE_LENGTH);
}
