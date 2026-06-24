// deno-lint-ignore-file no-explicit-any
import { matchPath, parsePathList } from "./pathlist.ts";
import { settingsSchema, type SecuritySettings } from "./schema.ts";
import type { App, Db, RequestContext } from "../core/mod.ts";

export const now = () => Math.floor(Date.now() / 1000);
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bucketCache = new WeakMap<object, Map<string, { until: number; row: Record<string, unknown> }>>();

export async function settings(app: App): Promise<SecuritySettings> {
  const s = app.settings["cms.backend.security"];
  const props = settingsSchema.properties as Record<string, { type: string; default: unknown }>;
  const result: Record<string, unknown> = {};
  for (const [key, meta] of Object.entries(props)) {
    const raw = await s[key];
    if (meta.type === "boolean") {
      result[key] = raw != null && raw !== "" ? raw === true || raw === "true" || raw === "1" : meta.default;
    } else if (meta.type === "integer") {
      const n = Number(raw);
      result[key] = (raw != null && raw !== "" && !isNaN(n)) ? n : meta.default;
    } else {
      result[key] = (raw != null && raw !== "") ? String(raw) : meta.default;
    }
  }
  return result as SecuritySettings;
}

export async function suspiciousPath(app: App, path: string) {
  const set = await settings(app);
  const allow = parsePathList(set.allowedPaths);
  const paths = parsePathList(set.suspiciousPaths);
  if (matchPath(allow, path)) return "";
  return matchPath(paths, path);
}


export function fastInfo(ctx: RequestContext): any {
  const path = short(ctx.appRequestPath || ctx.url.pathname, 191);
  const ip = ctx.remoteAddr || "";
  return {
    time: now(), ip, ip_range: ipRange(ip), client_id: Number(ctx.clientId || 0) || null, sess_id: Number(ctx.sess?.id || 0) || null,
    usr_id: Number(ctx.userId || 0) || null, method: ctx.req.method, path, status: 0, duration_ms: 0,
    bytes_in: Number(ctx.req.header("content-length") ?? "0") || 0, bytes_out: 0, ua: ctx.req.header("user-agent") ?? "",
  };
}

export function reqInfo(ctx: RequestContext): any {
  const info = fastInfo(ctx);
  const payload = payloadText(ctx);
  return {
    ...info,
    inspect: [info.path, payload].filter(Boolean).join("\n").slice(0, 8000),
  };
}

export async function hitBuckets(ctx: RequestContext, info: any, signals: any[], set: Record<string, number>) {
  for (const hit of bucketHits(info, signals, set)) {
    await hitBucket(ctx.app.db, hit.scope, hit.ident, hit.score, hit.reason, info.path, set);
  }
}

export function bucketHits(info: any, signals: any[], set: Record<string, number>) {
  const hits = new Map<string, any>();
  for (const s of signals) for (const [scope, ident, percent] of bucketScopes(info, set, s)) {
    if (!ident || percent <= 0) continue;
    const key = scope + "\n" + ident;
    const add = Math.max(1, Math.round(s.score * percent / 100));
    const old = hits.get(key);
    hits.set(key, { scope, ident, score: (old?.score ?? 0) + add, reason: s.reason });
  }
  return [...hits.values()];
}

async function hitBucket(db: Db, scope: string, ident: string, add: number, reason: string, path: string, set: Record<string, number>) {
  const t = now();
  const row = await getBucket(db, scope, ident, set);
  const score = Math.max(0, Number(row?.score ?? 0) - Math.round(((t - Number(row?.last_seen ?? t)) / 60) * set.decayPerMin)) + add;
  const data = { scope, ident, score, count: Number(row?.count ?? 0) + 1, blocked: score >= set.blockScore ? 1 : 0, first_seen: row?.first_seen ?? t, last_seen: t, reason, sample_path: short(path, 191), data: "" };
  if (row) {
    await db.table("m_security_bucket").update(row.id, data);
    setBucketCache(db, scope, ident, { ...row, ...data }, set);
  } else {
    const id = await db.table("m_security_bucket").insert(data);
    setBucketCache(db, scope, ident, { id, ...data }, set);
  }
}

export async function penaltyState(db: Db, info: any, set: Record<string, number>, signals: any[] = []) {
  const ids = bucketScopes(info, set).concat(...signals.map(s => bucketScopes(info, set, s))).map(([scope, ident]) => [scope, ident]).filter((x) => x[1]);
  let best: any = { score: 0, delay: 0, blocked: false, warn: false };
  for (const [scope, ident] of ids) {
    const row = await getBucket(db, scope, ident, set);
    if (!row || Number(row.score) <= best.score) continue;
    const score = Number(row.score);
    // Path buckets are load signals: slow down a hot URL, but do not block all visitors.
    const soft = scope.endsWith("path");
    const delayStart = soft ? set.pathDelayStartScore : set.delayStartScore;
    const delayFactor = soft ? set.pathDelayFactorMs : set.delayFactorMs;
    const maxDelay = soft ? set.pathMaxDelayMs : set.maxDelayMs;
    const delay = Math.min(maxDelay, Math.max(0, score - delayStart) * delayFactor);
    best = { scope, ident, reason: row.reason, score, delay, blocked: !soft && score >= set.blockScore, warn: score >= set.warnScore || delay > 0 };
  }
  return best;
}

async function getBucket(db: Db, scope: string, ident: string, set: Record<string, number>) {
  const key = bucketKey(scope, ident);
  const old = bucketCache.get(db)?.get(key);
  if (old && old.until > Date.now()) return old.row;
  const row = await db.row`SELECT * FROM m_security_bucket WHERE scope = ${scope} AND ident = ${ident} ORDER BY id LIMIT 1`;
  setBucketCache(db, scope, ident, row ?? null, set);
  return row;
}

function setBucketCache(db: Db, scope: string, ident: string, row: any, set: Record<string, number>) {
  const map = bucketCache.getOrInsertComputed(db, () => new Map());
  map.set(bucketKey(scope, ident), { until: Date.now() + Math.max(1, set.bucketCacheSeconds ?? 2) * 1000, row });
  if (map.size > 5000) map.delete(map.keys().next().value!);
}

const bucketKey = (scope: string, ident: string) => scope + "\n" + ident;

function bucketScopes(info: any, set: Record<string, number>, signal?: any): [string, string, number][] {
  if (signal?.kind === "login") return [
    ["login:ip", info.ip, set.loginScorePercent ?? 100],
    ["login:range", info.ip_range, Math.round((set.loginScorePercent ?? 100) * .5)],
    ["login:user", String(info.usr_id || ""), set.loginScorePercent ?? 100],
  ];
  const scopes: [string, string, number][] = [
    ["ip", info.ip, set.ipScorePercent ?? 100],
    ["range", info.ip_range, set.rangeScorePercent ?? 35],
    ["path", info.path, set.pathScorePercent ?? 15],
    ["client", String(info.client_id || ""), set.clientScorePercent ?? 70],
    ["user", String(info.usr_id || ""), set.userBucketPercent ?? 45],
  ];
  if (signal?.kind === "attack") scopes.push(
    ["attack:ip", info.ip, set.attackScorePercent ?? 100],
    ["attack:range", info.ip_range, Math.round((set.attackScorePercent ?? 100) * .5)],
    ["attack:path", info.path, set.attackScorePercent ?? 100],
  );
  return scopes;
}

export async function addEvent(ctx: RequestContext, data: Record<string, unknown>) {
  const logId = await ctx.logId;
  await addEventDb(ctx.app.db, { log_id: Number(logId || 0) || null, ...data });
}

export async function addEventDb(db: Db, data: Record<string, unknown>) {
  const extra = data.data ? JSON.stringify(data.data) : "";
  delete data.data;
  const event = {
    time: now(), prio: "notice", kind: "", scope: "", ident: "", reason: "", state: "", confidence: 0, severity: 0, score: 0, delay_ms: 0, blocked: 0,
    ip: "", ip_range: "", client_id: null, sess_id: null, usr_id: null, method: "", path: "", status: 0, duration_ms: 0, bytes_in: 0, bytes_out: 0, ua: "",
    ...data,
    data: extra,
  };
  if (!event.state && event.prio !== "notice") event.state = "new";
  await db.table("m_security_event").insert(event);
}

export async function cleanup(db: Db, set: Record<string, number>) {
  const old = now() - set.keepDays * 86400;
  await db.query`DELETE FROM m_security_event WHERE time < ${old}`;
  await db.query`DELETE FROM m_security_bucket WHERE last_seen < ${old} AND blocked = 0`;
}

function ipRange(ip: string): string {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":") + "::/64";
  return ip;
}

function payloadText(ctx: RequestContext): string {
  const entries = [...Object.entries(ctx.get ?? {}), ...Object.entries(ctx.post ?? {})]
    .filter(([k]) => !/pw|pass|password|token|secret/i.test(k))
    .map(([k, v]) => k + "=" + String(v));
  return entries.join("&");
}

const short = (s: string, n: number) => s.length > n ? s.slice(0, n) : s;
