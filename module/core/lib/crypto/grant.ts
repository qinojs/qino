import { createHmac, timingSafeEqual } from "node:crypto";

import { randB64, uid, unixTime } from "../util.ts";

import type { App } from "../App.ts";
import type { Session } from "../SessionManager.ts";

const TTL = 4 * 3600;
const SIGNATURE_LENGTH = 22;
const secrets = new WeakMap<App, Promise<string>>();

export type Params = { exp?: unknown; sig?: unknown };
export type SessionState = "ok" | "expired" | "forged" | "unsigned";
export type PermanentState = "ok" | "forged" | "unsigned";

export function sign(sess: Session, resource: string, options?: { ttl?: number }): { exp: string; sig: string };
export function sign(app: App, resource: string): Promise<{ sig: string }>;
export function sign(owner: Session | App, resource: string, options: { ttl?: number } = {}) {
  if (!isSession(owner)) return permanentSign(owner, resource);
  const exp = unixTime() + (options.ttl ?? TTL);
  return { exp: String(exp), sig: mac(sessionSecret(owner), resource, exp) };
}

export function verify(sess: Session, resource: string, params: Params): SessionState;
export function verify(app: App, resource: string, params: Params): Promise<PermanentState>;
export function verify(owner: Session | App, resource: string, params: Params): SessionState | Promise<PermanentState> {
  return isSession(owner) ? verifySession(owner, resource, params) : verifyPermanent(owner, resource, params);
}

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
  if (!/^\d{1,12}$/.test(raw) || !equal(mac(sessionSecret(sess), resource, Number(raw)), given)) return "forged";
  return Number(raw) < unixTime() ? "expired" : "ok";
}

async function permanentSign(app: App, resource: string): Promise<{ sig: string }> {
  return { sig: mac(await appSecret(app), resource) };
}

async function verifyPermanent(app: App, resource: string, { sig }: Params): Promise<PermanentState> {
  const given = String(sig ?? "");
  if (!given) return "unsigned";
  return equal(mac(await appSecret(app), resource), given) ? "ok" : "forged";
}

async function appSecret(app: App): Promise<string> {
  const setting = app.settings.core._secret;
  const stored = String(await setting ?? "");
  if (stored) return stored;
  return secrets.getOrInsertComputed(app, async () => {
    const value = randB64(32);
    await setting(value);
    return value;
  }).catch((e) => { secrets.delete(app); throw e; });
}

function mac(secret: string, resource: string, exp?: number): string {
  const value = exp === undefined ? resource : `${resource}\0${exp}`;
  return createHmac("sha256", secret).update(value).digest("base64url").slice(0, SIGNATURE_LENGTH);
}

function equal(expected: string, given: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(expected), b = encoder.encode(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
