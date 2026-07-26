import { Output, clientIp, type App, type Ctx } from "../core/mod.ts";
import { decide } from "./policy.ts";
import { actionSignals, rankSignal, rankSignals, responseSignal } from "./rules.ts";
import { addEvent, addEventDb, fastInfo, hitBuckets, penaltyState, reqInfo, settings, sleep, suspiciousPath } from "./store.ts";

// Per app, not module-global: apps in the same runtime must not share blocks.
const pathBlocks = new WeakMap<App, Map<string, number>>();
const blocksOf = (app: App) => pathBlocks.getOrInsertComputed(app, () => new Map());

const utf8 = new TextEncoder();
// Byte length of a serialized response body. Streams/forms are unknown up front → 0, not fake precision.
function bodySize(body: BodyInit | undefined): number {
  if (body == null) return 0;
  if (typeof body === "string") return utf8.encode(body).length;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength; // Uint8Array & other typed arrays
  if (body instanceof Blob) return body.size;
  return 0;
}

export function initSecurity(app: App, signal: AbortSignal) {
  app.on("request-start", async ({ request, peerAddr }) => {
    const info = gateInfo(request, peerAddr, app.trustedProxyHops);
    if (isPathBlocked(app, info)) deny(5);
    const set = await settings(app);
    if (!set.enabled) return;
    const pattern = await suspiciousPath(app, info.path);
    if (!pattern) return;
    rememberPathBlock(app, info, set);
    await addEventDb(app.db, { ...info, prio: "error", kind: "path-block", scope: "ip", ident: info.ip, reason: "suspicious path: " + pattern, confidence: 98, severity: 100, score: set.blockScore, blocked: true });
    deny(set.pathBlockSeconds);
  }, { signal });

  app.on("route", async ({ ctx }) => {
    const fast = fastInfo(ctx);
    if (isPathBlocked(ctx.app, fast)) return block(ctx, 5);
    const set = await settings(ctx.app);
    if (!set.enabled) return;
    const pattern = await suspiciousPath(ctx.app, fast.path);
    if (pattern) {
      rememberPathBlock(ctx.app, fast, set);
      await addEvent(ctx, { ...fast, prio: "error", kind: "path-block", scope: "ip", ident: fast.ip, reason: "suspicious path: " + pattern, confidence: 98, severity: 100, score: set.blockScore, blocked: true });
      return block(ctx, set.pathBlockSeconds);
    }
    ctx.state.security = { start: performance.now() };

    const info = reqInfo(ctx);
    const signals = rankSignals(actionSignals(ctx, info), info, set);

    await hitBuckets(ctx, info, signals, set);
    for (const s of signals) await addEvent(ctx, { ...info, ...s });

    const penalty = await penaltyState(ctx.app.db, info, set, signals);
    const policy = decide(penalty, signals, set, await ctx.user?.get("superuser"));
    if (policy.warn) await addEvent(ctx, { ...info, prio: policy.prio, kind: "throttle", scope: policy.scope, ident: policy.ident, reason: policy.reason, confidence: policy.confidence, severity: policy.severity, score: policy.score, delay_ms: policy.delay, blocked: policy.blocked });
    if (policy.blocked) {
      ctx.res.status = 429;
      ctx.res.headers.set("Retry-After", String(Math.ceil(policy.delay / 1000) || 5));
      ctx.res.body = "Too many requests";
      throw new Output();
    }
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

function isPathBlocked(app: App, info: GateInfo) {
  const blocks = blocksOf(app);
  const key = blockKey(info);
  const until = blocks.get(key) ?? 0;
  if (until > Date.now()) return true;
  if (until) blocks.delete(key);
  return false;
}

function rememberPathBlock(app: App, info: GateInfo, set: Record<string, number>) {
  const blocks = blocksOf(app);
  shrinkPathBlocks(blocks, set.pathBlockMax ?? 5000);
  blocks.set(blockKey(info), Date.now() + Math.max(1, set.pathBlockSeconds ?? 900) * 1000);
}

function shrinkPathBlocks(blocks: Map<string, number>, max: number) {
  max = Math.max(1, max);
  const t = Date.now();
  for (const [key, until] of blocks) if (until <= t) blocks.delete(key);
  while (blocks.size >= max) {
    const key = blocks.keys().next().value;
    if (!key) break;
    blocks.delete(key);
  }
}

function block(ctx: Ctx, seconds: number) {
  ctx.res.status = 429;
  ctx.res.headers.set("Retry-After", String(Math.max(1, Math.ceil(seconds))));
  ctx.res.body = "Too many requests";
  throw new Output();
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
