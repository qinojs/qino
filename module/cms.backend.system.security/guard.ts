import { Output, clientIp } from "@qino/qino";

import { decide } from "./policy.ts";
import { actionSignals, rankSignal, rankSignals, responseSignal } from "./rules.ts";
import { addEvent, addEventDb, fastInfo, hitBuckets, penaltyState, reqInfo, settings, sleep, suspiciousPath } from "./store.ts";

import type { App, Ctx } from "@qino/qino";
import type { SecuritySettings } from "./schema.ts";

// Per app, not module-global: apps in the same runtime must not share blocks.
const pathBlocks = new WeakMap<App, Map<string, number>>();
const blocksOf = (app: App) => pathBlocks.getOrInsertComputed(app, () => new Map());

const utf8 = new TextEncoder();
// Byte length of a serialized response body. Streams/forms are unknown up front → 0, not fake precision.
function bodySize(body: BodyInit | undefined): number {
  if (body == null) return 0;
  if (typeof body === "string") return utf8.encode(body).length;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength; // ArrayBuffer & typed arrays
  if (body instanceof Blob) return body.size;
  return 0;
}

export function initSecurity(app: App, signal: AbortSignal) {
  // Before any DB/session work — this one also sees static files and requests that never reach a route.
  app.on("request-start", async ({ request, peerAddr }) => {
    await pathGate(app, gateInfo(request, peerAddr, app.trustedProxyHops));
  }, { signal });

  app.on("route", async ({ ctx }) => {
    const fast = fastInfo(ctx);
    const set = await pathGate(app, fast, ctx);
    if (!set.enabled) return;
    ctx.state.security = { start: performance.now() };

    const info = reqInfo(ctx);
    const signals = rankSignals(actionSignals(ctx, info), info, set);

    await hitBuckets(ctx, info, signals, set);
    for (const s of signals) await addEvent(ctx, { ...info, ...s });

    const penalty = await penaltyState(ctx.app.db, info, set, signals);
    const policy = decide(penalty, signals, set, ctx.user?.superuser);
    if (policy.warn) await addEvent(ctx, { ...info, prio: policy.prio, kind: "throttle", scope: policy.scope, ident: policy.ident, reason: policy.reason, confidence: policy.confidence, severity: policy.severity, score: policy.score, delay_ms: policy.delay, blocked: policy.blocked });
    if (policy.blocked) deny(policy.delay / 1000 || 5);
    if (policy.delay) await sleep(policy.delay);
  }, { signal });

  app.on("respond", async ({ ctx }) => {
    const sec = ctx.state.security;
    if (!sec) return;
    const set = await settings(ctx.app);
    if (!set.enabled) return;
    const info = reqInfo(ctx);
    info.status = ctx.res.status;
    info.duration_ms = Math.round(performance.now() - sec.start);
    info.bytes_out = bodySize(ctx.res.body);
    const signal = responseSignal(info, set);
    if (!signal) return;
    const ranked = rankSignal(signal, info, set);
    await hitBuckets(ctx, info, [ranked], set);
    await addEvent(ctx, { ...info, ...ranked });
  }, { signal });
}

type GateInfo = { ip: string; method: string; path: string; bytes_in: number; ua: string };

/** Both gates: deny what is blocked, block what asks for a suspicious path. `ctx` only decides
 *  where the event goes — request-start has none yet. Returns the settings the caller goes on with. */
async function pathGate(app: App, info: GateInfo, ctx?: Ctx): Promise<SecuritySettings> {
  if (isPathBlocked(app, info)) deny(5);
  const set = await settings(app);
  const pattern = set.enabled ? suspiciousPath(set, info.path) : "";
  if (pattern) {
    rememberPathBlock(app, info, set);
    const event = { ...info, prio: "error", kind: "path-block", scope: "ip", ident: info.ip, reason: "suspicious path: " + pattern, confidence: 98, severity: 100, score: set.blockScore, blocked: true };
    await (ctx ? addEvent(ctx, event) : addEventDb(app.db, event));
    deny(set.pathBlockSeconds);
  }
  return set;
}

function isPathBlocked(app: App, info: GateInfo) {
  const blocks = blocksOf(app);
  const key = blockKey(info);
  if ((blocks.get(key) ?? 0) > Date.now()) return true;
  blocks.delete(key);
  return false;
}

function rememberPathBlock(app: App, info: GateInfo, set: SecuritySettings) {
  const blocks = blocksOf(app);
  shrinkPathBlocks(blocks, set.pathBlockMax);
  blocks.set(blockKey(info), Date.now() + Math.max(1, set.pathBlockSeconds) * 1000);
}

function shrinkPathBlocks(blocks: Map<string, number>, max: number) {
  const t = Date.now();
  for (const [key, until] of blocks) if (until <= t) blocks.delete(key);
  for (const key of blocks.keys()) {
    if (blocks.size < Math.max(1, max)) break;
    blocks.delete(key);
  }
}

function blockKey(info: GateInfo) {
  return info.ip ? "ip:" + info.ip : "path:" + info.path;
}

function gateInfo(request: Request, peerAddr: string, hops: number): GateInfo {
  const ip = clientIp(request, peerAddr, hops);
  return {
    ip, method: request.method, path: safeDecode(new URL(request.url).pathname).slice(0, 191),
    bytes_in: Number(request.headers.get("content-length")) || 0, ua: request.headers.get("user-agent") ?? "",
  };
}

function deny(seconds: number): never {
  throw new Output("Too many requests", { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(seconds))) } });
}

function safeDecode(s: string) {
  try { return decodeURIComponent(s); } catch { return s; }
}
