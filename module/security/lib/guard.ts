import { Output } from "@qino/qino";
import { forget, hit, scored, scopes, strength } from "@qino/qino/score";

import { ipKey } from "./ipKey.ts";

import type { App, Ctx } from "@qino/qino";

export const HALF_LIFE = 3600;  // a suspicion halves every hour
export const BLOCK = 50;       // from this strength on, answers are refused; below, they wait strength² ms
const STORE = 5;               // from this strength on, it is stored
const MAX = 10000;             // at most this many tracked keys
const REPORTS = 100;           // recent reports kept for the backend

const newState = () => ({
  keys: new Map<string, { s: number; t: number; stored?: boolean }>(),
  reports: [] as { time: number; ip: string; weight: number; reason: string }[],
  writes: new Map<string, Promise<void>>(),
});

const states = new WeakMap<App, ReturnType<typeof newState>>();
const now = () => Date.now() / 1000;
const decay = (e: { s: number; t: number }, t: number) => e.s * 2 ** ((e.t - t) / HALF_LIFE);

/** Registers the score scope and warms the in-memory view, so a restart does not forgive anyone. */
export async function load(app: App): Promise<void> {
  await scored(app.db, "log_ip", HALF_LIFE);
  const state = newState();
  states.set(app, state);
  const rows = await app.db.query`SELECT l.ip, s.score FROM score s JOIN log_ip l ON l.id = s.id WHERE s.scope_id = ${scopes(app.db).get("log_ip")!.id}`;
  for (const row of rows) {
    const s = strength(app.db, "log_ip", Number(row.score));
    if (s >= 1) state.keys.set(String(row.ip), { s, t: now(), stored: true });
  }
}

export function reportCtx(ctx: Ctx, weight: number, reason: string): void {
  if (ctx.user?.superuser) return; // superusers do not lock themselves out
  reportIp(ctx.app, ctx.req.clientIp, weight, reason);
}

export function reportIp(app: App, ip: string, weight: number, reason: string): void {
  if (!ip) return;
  const { keys, reports } = states.get(app)!;
  const key = ipKey(ip);
  const t = now();
  reports.unshift({ time: t, ip, weight, reason });
  reports.length = Math.min(reports.length, REPORTS);
  const e = keys.get(key);
  // A full map drops the faded ones, then the weakest until it fits; what is stored comes back anyway.
  if (!e && keys.size >= MAX) {
    for (let min = 1; keys.size >= MAX; min *= 2) {
      for (const [k, v] of keys) if (decay(v, t) < min) keys.delete(k);
    }
  }
  const next = { s: (e ? decay(e, t) : 0) + weight, t, stored: e?.stored };
  keys.set(key, next);
  // One-off slips stay in memory; the first store carries what was collected so far.
  if (next.s < STORE) return;
  const add = next.stored ? weight : next.s;
  next.stored = true;
  store(app, key, add);
}

/** Writes of one key run one after another, so they neither insert its row twice nor lose a hit. */
function store(app: App, key: string, add: number): void {
  const { writes } = states.get(app)!;
  const write = (writes.get(key) ?? Promise.resolve())
    .then(async () => hit(app.db, "log_ip", await keyId(app, key), add))
    .catch((e) => console.error("security: " + e.message))
    .finally(() => writes.get(key) === write && writes.delete(key));
  writes.set(key, write);
}

/** The log_ip row of a key; an IPv6 network gets its own row next to the addresses.
 *  A concurrent insert by the request log wins the race; its row is read then. */
async function keyId(app: App, key: string): Promise<number> {
  const table = app.db.table("log_ip");
  const find = () => table.rowBy("ip", key);
  const row = await find() ?? await table.insert({ ip: key }).catch(find);
  return Number(String(row));
}

/** Seconds until a strength drops below BLOCK, negative when it is not blocked. */
const blockedFor = (s: number) => Math.ceil(Math.log2(s / BLOCK) * HALF_LIFE);

/** Before any other work, so static files are covered too. Synchronous unless it delays. */
export function gate(app: App, ip: string): Promise<void> | void {
  const { keys } = states.get(app)!;
  if (!keys.size) return; // the usual case: nobody is suspect
  const key = ipKey(ip);
  const e = keys.get(key);
  if (!e) return;
  const s = decay(e, now());
  if (s < 1) return void keys.delete(key);
  const wait = blockedFor(s);
  if (wait >= 0) throw new Output("Too many requests", { status: 429, headers: { "Retry-After": String(wait || 1) } });
  return new Promise<void>((resolve) => setTimeout(resolve, s * s));
}

/** Tracked keys (see ipKey), strongest first. `blocked` is seconds left, 0 when only delayed. */
export function suspects(app: App) {
  const t = now();
  return [...states.get(app)?.keys ?? []]
    .map(([key, e]) => {
      const s = decay(e, t);
      return { key, strength: s, delay: s * s, blocked: Math.max(0, blockedFor(s) || 1), time: e.t };
    })
    .filter((e) => e.strength >= 1)
    .sort((a, b) => b.strength - a.strength);
}

/** Recent reports, newest first. In memory only. */
export const reports = (app: App) => states.get(app)?.reports ?? [];

/** Forgive a key (see ipKey), in memory and in the stored score. */
export async function release(app: App, key: string): Promise<void> {
  const state = states.get(app);
  state?.keys.delete(key);
  await state?.writes.get(key); // a pending write would bring the score back
  const row = await app.db.table("log_ip").rowBy("ip", key);
  if (row) await forget(app.db, "log_ip", Number(String(row)));
}
