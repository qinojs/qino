// deno-lint-ignore-file no-explicit-any
import { matchPath, parsePathList } from "./pathlist.ts";
import { defaults, textDefaults } from "./schema.ts";

export const now = () => Math.floor(Date.now() / 1000);
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cache = new WeakMap<object, { until: number; set: Record<string, number>; text: Record<string, string>; paths: string[]; allow: string[] }>();
const bucketCache = new WeakMap<object, Map<string, { until: number; row: any }>>();

export async function ensureDefaults(db: any) {
  for (const [name, value] of Object.entries({ ...defaults, ...textDefaults })) {
    if (!await db.one("SELECT name FROM m_security_setting WHERE name = ?", [name])) await db.table("m_security_setting").insert({ name, value: String(value) });
  }
}

export async function saveSetting(db: any, name: string, value: string) {
  if (await db.one("SELECT name FROM m_security_setting WHERE name = ?", [name])) await db.table("m_security_setting").update(name, { name, value });
  else await db.table("m_security_setting").insert({ name, value });
  clearCache(db);
}

export async function settings(db: any): Promise<Record<string, number>> {
  return (await loadSettings(db)).set;
}

export async function textSettings(db: any): Promise<Record<string, string>> {
  return (await loadSettings(db)).text;
}

export function clearCache(db: any) {
  cache.delete(db);
}

export async function suspiciousPath(db: any, path: string) {
  const data = await loadSettings(db);
  if (matchPath(data.allow, path)) return "";
  return matchPath(data.paths, path);
}

async function loadSettings(db: any) {
  const old = cache.get(db);
  if (old && old.until > Date.now()) return old;
  const rows = await db.all("SELECT name,value FROM m_security_setting");
  const set = { ...defaults };
  const text = { ...textDefaults };
  for (const r of rows) if (r.name in set) set[r.name] = Number(r.value) || 0;
  for (const r of rows) if (r.name in text) text[r.name] = String(r.value ?? "");
  const data = { until: Date.now() + Math.max(1, set.settingCacheSeconds) * 1000, set, text, paths: parsePathList(text.suspiciousPaths), allow: parsePathList(text.allowedPaths) };
  cache.set(db, data);
  return data;
}

export function fastInfo(ctx: any): any {
  const path = ctx.appRequestUri || new URL(ctx.req.url).pathname;
  const ip = ctx.remoteAddr || "";
  return {
    time: now(), ip, ip_range: ipRange(ip), client_id: Number(ctx.clientId || 0) || null, sess_id: Number(ctx.sessId || 0) || null,
    usr_id: Number(ctx.userId || 0) || null, method: ctx.req.method, path, status: 0, duration_ms: 0,
    bytes_in: Number(ctx.req.header("content-length") ?? "0") || 0, bytes_out: 0, ua: ctx.req.header("user-agent") ?? "",
  };
}

export function reqInfo(ctx: any): any {
  const info = fastInfo(ctx);
  const payload = payloadText(ctx);
  return {
    ...info,
    inspect: [info.path, payload].filter(Boolean).join("\n").slice(0, 8000),
  };
}

export async function hitBuckets(ctx: any, info: any, signals: any[], set: Record<string, number>) {
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

async function hitBucket(db: any, scope: string, ident: string, add: number, reason: string, path: string, set: Record<string, number>) {
  const t = now();
  const row = await getBucket(db, scope, ident, set);
  const score = Math.max(0, Number(row?.score ?? 0) - Math.round(((t - Number(row?.last_seen ?? t)) / 60) * set.decayPerMin)) + add;
  const data = { scope, ident, score, count: Number(row?.count ?? 0) + 1, blocked: score >= set.blockScore ? 1 : 0, first_seen: row?.first_seen ?? t, last_seen: t, reason, sample_path: path, data: "" };
  if (row) {
    await db.table("m_security_bucket").update(row.id, data);
    setBucketCache(db, scope, ident, { ...row, ...data }, set);
  } else {
    const id = await db.table("m_security_bucket").insert(data);
    setBucketCache(db, scope, ident, { id, ...data }, set);
  }
}

export async function penaltyState(db: any, info: any, set: Record<string, number>, signals: any[] = []) {
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

async function getBucket(db: any, scope: string, ident: string, set: Record<string, number>) {
  const key = bucketKey(scope, ident);
  const old = bucketCache.get(db)?.get(key);
  if (old && old.until > Date.now()) return old.row;
  const row = await db.row("SELECT * FROM m_security_bucket WHERE scope = ? AND ident = ? ORDER BY id LIMIT 1", [scope, ident]);
  setBucketCache(db, scope, ident, row ?? null, set);
  return row;
}

function setBucketCache(db: any, scope: string, ident: string, row: any, set: Record<string, number>) {
  const map = bucketCache.get(db) ?? new Map();
  bucketCache.set(db, map);
  map.set(bucketKey(scope, ident), { until: Date.now() + Math.max(1, set.bucketCacheSeconds ?? 2) * 1000, row });
  if (map.size > 5000) map.delete(map.keys().next().value);
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

export async function addEvent(ctx: any, data: any) {
  await addEventDb(ctx.app.db, { log_id: Number(ctx.logId || 0) || null, ...data });
}

export async function addEventDb(db: any, data: any) {
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

export async function cleanup(db: any, set: Record<string, number>) {
  const old = now() - set.keepDays * 86400;
  await db.query("DELETE FROM m_security_event WHERE time < ?", [old]);
  await db.query("DELETE FROM m_security_bucket WHERE last_seen < ? AND blocked = 0", [old]);
}

function ipRange(ip: string): string {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":") + "::/64";
  return ip;
}

function payloadText(ctx: any): string {
  const entries = [...Object.entries(ctx.get ?? {}), ...Object.entries(ctx.post ?? {})]
    .filter(([k]) => !/pw|pass|password|token|secret/i.test(k))
    .map(([k, v]) => k + "=" + String(v));
  return entries.join("&");
}
