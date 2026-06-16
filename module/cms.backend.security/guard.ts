import { Output, clientIp, type App, type Req, type RequestContext } from "../core/mod.ts";
import { decide } from "./policy.ts";
import { actionSignals, rankSignal, rankSignals, responseSignal } from "./rules.ts";
import { addEvent, addEventDb, cleanup, fastInfo, hitBuckets, penaltyState, reqInfo, settings, sleep, suspiciousPath } from "./store.ts";

const pathBlocks = new Map<string, number>();

export function initSecurity(app: App) {
  app.on("request-start", async e => {
    const info = gateInfo(e.req as Req, app.trustedProxyHops);
    if (isPathBlocked(info)) return deny(5);
    const set = await settings(app);
    if (!set.enabled) return;
    const pattern = await suspiciousPath(app, info.path);
    if (!pattern) return;
    rememberPathBlock(info, set);
    await addEventDb(app.db, { ...info, prio: "error", kind: "path-block", scope: "ip", ident: info.ip, reason: "suspicious path: " + pattern, confidence: 98, severity: 100, score: set.blockScore, blocked: 1 });
    deny(set.pathBlockSeconds);
  });

  app.on("action", async e => {
    const ctx = e.ctx as RequestContext;
    const fast = fastInfo(ctx);
    if (isPathBlocked(fast)) return block(ctx, 5);
    const set = await settings(ctx.app);
    if (!set.enabled) return;
    const pattern = await suspiciousPath(ctx.app, fast.path);
    if (pattern) {
      rememberPathBlock(fast, set);
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
    const policy = decide(penalty, signals, set, await ctx.user?.get?.("superuser"));
    if (policy.warn) await addEvent(ctx, { ...info, prio: policy.prio, kind: "throttle", scope: policy.scope, ident: policy.ident, reason: policy.reason, confidence: policy.confidence, severity: policy.severity, score: policy.score, delay_ms: policy.delay, blocked: policy.blocked });
    if (policy.blocked) {
      ctx.responseStatus = 429;
      ctx.responseHeaders.set("Retry-After", String(Math.ceil(policy.delay / 1000) || 5));
      ctx.responseBody = "Too many requests";
      throw new Output();
    }
    if (policy.delay) await sleep(policy.delay);
  });

  app.on("respond", async e => {
    const ctx = e.ctx as RequestContext;
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

function isPathBlocked(info: GateInfo) {
  const key = blockKey(info);
  const until = pathBlocks.get(key) ?? 0;
  if (until > Date.now()) return true;
  if (until) pathBlocks.delete(key);
  return false;
}

function rememberPathBlock(info: GateInfo, set: Record<string, number>) {
  shrinkPathBlocks(set.pathBlockMax ?? 5000);
  pathBlocks.set(blockKey(info), Date.now() + Math.max(1, set.pathBlockSeconds ?? 900) * 1000);
}

function shrinkPathBlocks(max: number) {
  max = Math.max(1, max);
  const t = Date.now();
  for (const [key, until] of pathBlocks) if (until <= t) pathBlocks.delete(key);
  while (pathBlocks.size >= max) {
    const key = pathBlocks.keys().next().value;
    if (!key) break;
    pathBlocks.delete(key);
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

function gateInfo(req: Req, hops: number): GateInfo {
  const ip = clientIp(req, hops);
  return { ip, method: req.method, path: safeDecode(new URL(req.url).pathname).slice(0, 191), bytes_in: Number(req.header("content-length") ?? "0") || 0, ua: req.header("user-agent") ?? "" };
}

function deny(seconds: number): never {
  throw new Output("Too many requests", { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(seconds))) } });
}

function safeDecode(s: string) {
  try { return decodeURIComponent(s); } catch { return s; }
}
