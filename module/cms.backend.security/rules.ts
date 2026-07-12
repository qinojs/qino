// deno-lint-ignore-file no-explicit-any
import { attacks, probes } from "./patterns.ts";

export type Signal = {
  prio: string;
  kind: string;
  scope: string;
  ident: string;
  reason: string;
  confidence: number;
  severity: number;
  score: number;
};

export function actionSignals(ctx: any, info: any): Signal[] {
  const hits = probes
    .filter(([r]) => r.test(info.path))
    .map(([, reason, score, confidence]) => signal("warning", "probe", "ip", info.ip, reason, score, confidence));
  hits.push(...attacks
    .filter(([r]) => r.test(info.inspect ?? info.path))
    .map(([, reason, score, confidence]) => signal("error", "attack", "ip", info.ip, reason, score, confidence)));
  if (ctx.loginError) {
    hits.push(signal("warning", "login", "ip", info.ip, "login failed: " + ctx.loginError, ctx.loginError === "password" ? 45 : 25, ctx.loginError === "password" ? 85 : 65));
  }
  return hits;
}

export function responseSignal(info: any, set: Record<string, number>): Signal | null {
  let score = info.status >= 500 ? 18 : info.status >= 400 ? 8 : 1;
  let reason = info.status >= 400 ? "http " + info.status : "request";
  let prio = info.status >= 500 ? "error" : "notice";
  let kind = "request";
  const warnMs = set.requestWarnMs || set.slowMs || 1500;
  const maxMs = Math.max(warnMs + 1, set.requestMaxMs || warnMs * 6);
  // Soft timeout: a real abort needs a core wrapper around the request flow.
  if (info.duration_ms > maxMs) { score += Math.min(90, Math.round(info.duration_ms / maxMs) * 30); reason = "request max time"; prio = "error"; kind = "load"; }
  else if (info.duration_ms > warnMs) { score += Math.min(50, Math.round(info.duration_ms / warnMs) * 8); reason = "request warn time"; prio = "warning"; kind = "load"; }
  if (info.bytes_in > set.largeBody) { score += Math.min(50, Math.round(info.bytes_in / set.largeBody) * 10); reason = "large body"; }
  if (score <= 1) return null;
  return signal(prio, kind, "path", info.path, reason, score, prio === "error" ? 85 : 60);
}

export function rankSignal(s: Signal, info: any, set: Record<string, number>): Signal {
  if (!info.usr_id || s.kind === "attack") return s;
  const percent = Math.max(0, Math.min(100, set.userScorePercent ?? 50));
  const score = Math.max(1, Math.round(s.score * percent / 100));
  const confidence = Math.max(1, Math.round(s.confidence * percent / 100));
  return { ...s, score, confidence, severity: severity(score, confidence) };
}

export function rankSignals(signals: Signal[], info: any, set: Record<string, number>) {
  return signals.map(s => rankSignal(s, info, set));
}

function signal(prio: string, kind: string, scope: string, ident: string, reason: string, score: number, confidence: number): Signal {
  return { prio, kind, scope, ident, reason, confidence, severity: severity(score, confidence), score };
}

function severity(score: number, confidence: number) {
  return Math.max(1, Math.min(100, Math.round((score + confidence) / 2)));
}
