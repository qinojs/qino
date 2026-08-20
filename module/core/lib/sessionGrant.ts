import { createHmac, timingSafeEqual } from "node:crypto";

import { uid, unixTime } from "./util.ts";

import type { Ctx } from "./ctx/Ctx.ts";

const TTL = 4 * 3600;
const SIGNATURE_LENGTH = 22;

function key(ctx: Ctx): string {
  const item = ctx.sess.data.core.grantKey;
  let value = String(item() ?? "");
  if (!value) item(value = uid());
  return value;
}

function signature(ctx: Ctx, scope: string, resource: string, exp: number): string {
  return createHmac("sha256", key(ctx)).update(`${scope}\0${resource}\0${exp}`).digest("base64url").slice(0, SIGNATURE_LENGTH);
}

/** A capability bound to this session and resource, valid for four hours by default. */
export function createSessionGrant(ctx: Ctx, scope: string, resource: string, ttl = TTL): { exp: string; sig: string } {
  const exp = unixTime() + ttl;
  return { exp: String(exp), sig: signature(ctx, scope, resource, exp) };
}

export type SessionGrantState = "ok" | "expired" | "forged" | "unsigned";

export function checkSessionGrant(ctx: Ctx, scope: string, resource: string, exp: unknown, sig: unknown): SessionGrantState {
  const raw = String(exp ?? ""), given = String(sig ?? "");
  if (!raw && !given) return "unsigned";
  if (!/^\d{1,12}$/.test(raw) || !equal(signature(ctx, scope, resource, Number(raw)), given)) return "forged";
  return Number(raw) < unixTime() ? "expired" : "ok";
}

function equal(expected: string, given: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(expected), b = encoder.encode(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
