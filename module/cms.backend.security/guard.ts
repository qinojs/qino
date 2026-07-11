import { Output, clientIp, type App, type RequestContext } from "../core/mod.ts";
import { decide } from "./policy.ts";
import { actionSignals, rankSignal, rankSignals, responseSignal } from "./rules.ts";
import { addEvent, addEventDb, cleanup, fastInfo, hitBuckets, penaltyState, reqInfo, settings, sleep, suspiciousPath } from "./store.ts";

// Per app, not module-global: apps in the same runtime must not share blocks.
const pathBlocks = new WeakMap<App, Map<string, number>>();
const blocksOf = (app: App) => pathBlocks.getOrInsertComputed(app, () => new Map());

export function initSecurity(app: App) {
  app.on("request-start", async ({ request, peerAddr }) => {
    const info = gateInfo(request, peerAddr, app.trustedProxyHops);
    if (isPathBlocked(app, info)) return deny(5);
    const set = await settings(app);
    if (!set.enabled) return;
    const pattern = await suspiciousPath(app, info.path);
    if (!pattern) return;
    rememberPathBlock(app, info, set);
    await addEventDb(app.db, { ...info, prio: "error", kind: "path-block", scope: "ip", ident: info.ip, reason: "suspicious path: " + pattern, confidence: 98, severity: 100, score: set.blockScore, blocked: 1 });
    deny(set.pathBlockSeconds);
  });

  app.on("action", async ({ ctx }) => {
    const fast = fastInfo(ctx);
    if (isPathBlocked(ctx.app, fast)) return block(ctx, 5);
    const set = await settings(ctx.app);
    if (!set.enabled) return;
    const pattern = await suspiciousPath(ctx.app, fast.path);
    if (pattern) {
      rememberPathBlock(ctx.app, fast, set);
      await addEvent(ctx, { ...fast, prio: "error", kind: "path-block", scope: "ip", ident: fast.ip, reason: "suspicious path: " + pattern, confidence: 98, severity: 100, score: set.blockScore, blocked: 1 });
      return block(ctx, set.pathBlockSeconds);
    }
    ctx.state.security = { start: performance.now() };
    if (Math.random() < .01) await cleanup(ctx.app.db, set);

    const info = reqInfo(ctx);
    const signals = rankSignals(actionSignals(ctx, info), info, set);

    await hitBuckets(ctx, info, signals, set);
    for (const s of signals) await addEvent(ctx, { ...info, ...s });

    const penalty = await penaltyState(ctx.app.db, info, set, signals);
    const policy = decide(penalty, signals, set, await ctx.user?.get("superuser"));
    if (policy.warn) await addEvent(ctx, { ...info, prio: policy.prio, kind: "throttle", scope: policy.scope, ident: policy.ident, reason: policy.reason, confidence: policy.confidence, severity: policy.severity, score: policy.score, delay_ms: policy.delay, blocked: policy.blocked });
    if (policy.blocked) {
      ctx.responseStatus = 429;
      ctx.responseHeaders.set("Retry-After", String(Math.ceil(policy.delay / 1000) || 5));
      ctx.responseBody = "Too many requests";
      throw new Output();
    }
    if (policy.delay) await sleep(policy.delay);
  });

  app.on("respond", async ({ ctx }) => {
    const sec = ctx.state.security;
    if (!sec) return;
    const set = await settings(ctx.app);
    if (!set.enabled) return;
    const info = reqInfo(ctx);
    info.status = ctx.responseStatus;
    info.duration_ms = Math.round(performance.now() - sec.start);
    info.bytes_out = String(ctx.responseBody ?? "").length;
    const signal = responseSignal(info, set);
    if (!signal) return;
    const ranked = rankSignal(signal, info, set);
    await hitBuckets(ctx, info, [ranked], set);
    await addEvent(ctx, { ...info, ...ranked });
  });
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

function block(ctx: RequestContext, seconds: number) {
  ctx.responseStatus = 429;
  ctx.responseHeaders.set("Retry-After", String(Math.max(1, Math.ceil(seconds))));
  ctx.responseBody = "Too many requests";
  throw new Output();
}

function blockKey(info: GateInfo) {
  return info.ip ? "ip:" + info.ip : "path:" + info.path;
}

function gateInfo(request: Request, peerAddr: string, hops: number): GateInfo {
  const ip = clientIp(request, peerAddr, hops);
  return { ip, method: request.method, path: safeDecode(new URL(request.url).pathname).slice(0, 191), bytes_in: Number(request.headers.get("content-length") ?? "0") || 0, ua: request.headers.get("user-agent") ?? "" };
}

function deny(seconds: number): never {
  throw new Output("Too many requests", { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(seconds))) } });
}

function safeDecode(s: string) {
  try { return decodeURIComponent(s); } catch { return s; }
}
