import { Output } from "@qino/qino";
import { forget, hit, scored, scopes, strength } from "@qino/qino/score";

import type { App, Ctx } from "@qino/qino";

export const HALF = 3600;  // a suspicion halves every hour
export const BLOCK = 50;   // from this strength on, answers are refused; below, they wait strength² ms
const KEEP = 5;            // from this strength on, it is stored
const MAX = 10000;         // tracked IPs before faded ones are swept
const REPORTS = 100;       // recent reports kept for the backend

type Entry = { s: number; t: number; stored?: boolean };
export type Report = { time: number; ip: string; weight: number; reason: string };
type State = { ips: Map<string, Entry>; reports: Report[] };

const states = new WeakMap<App, State>();
const now = () => Date.now() / 1000;
const decay = (e: Entry, t: number) => e.s * 2 ** ((e.t - t) / HALF);

/** Registers the score scope and warms the in-memory view, so a restart does not forgive anyone. */
export async function start(app: App): Promise<void> {
  await scored(app.db, "log_ip", HALF);
  const state: State = { ips: new Map(), reports: [] };
  states.set(app, state);
  const rows = await app.db.query`SELECT l.ip, s.score FROM score s JOIN log_ip l ON l.id = s.id WHERE s.scope_id = ${scopes(app.db).get("log_ip")!.id}`;
  for (const row of rows) {
    const s = strength(app.db, "log_ip", Number(row.score));
    if (s >= 1) state.ips.set(String(row.ip), { s, t: now(), stored: true });
  }
}

export async function suspect(ctx: Ctx, weight: number, reason: string): Promise<void> {
  const ip = ctx.req.clientIp;
  if (!ip) return;
  const { ips, reports } = states.get(ctx.app)!;
  const t = now();
  reports.unshift({ time: t, ip, weight, reason });
  reports.length = Math.min(reports.length, REPORTS);
  const e = ips.get(ip);
  if (!e && ips.size >= MAX) for (const [k, v] of ips) if (decay(v, t) < 1) ips.delete(k);
  const next: Entry = { s: (e ? decay(e, t) : 0) + weight, t, stored: e?.stored };
  ips.set(ip, next);
  // One-off slips stay in memory; the first store carries what was collected so far.
  if (next.s < KEEP) return;
  const id = await ctx.app.db.one`SELECT id FROM log_ip WHERE ip = ${ip}`;
  if (id) hit(ctx.app.db, "log_ip", Number(id), next.stored ? weight : next.s);
  next.stored = true;
}

/** Seconds until the IP drops below BLOCK, negative when it is not blocked. */
const blockedFor = (s: number) => Math.ceil(Math.log2(s / BLOCK) * HALF);

/** Before any other work, so static files are covered too. */
export async function gate(app: App, ip: string): Promise<void> {
  const { ips } = states.get(app)!;
  const e = ips.get(ip);
  if (!e) return;
  const s = decay(e, now());
  if (s < 1) return void ips.delete(ip);
  const wait = blockedFor(s);
  if (wait >= 0) throw new Output("Too many requests", { status: 429, headers: { "Retry-After": String(wait || 1) } });
  await new Promise((resolve) => setTimeout(resolve, s * s));
}

/** Tracked IPs, strongest first. `blocked` is seconds left, 0 when only delayed. */
export function suspects(app: App): { ip: string; strength: number; delay: number; blocked: number; time: number }[] {
  const t = now();
  return [...states.get(app)?.ips ?? []]
    .map(([ip, e]) => {
      const s = decay(e, t);
      return { ip, strength: s, delay: s * s, blocked: Math.max(0, blockedFor(s) || 1), time: e.t };
    })
    .filter((e) => e.strength >= 1)
    .sort((a, b) => b.strength - a.strength);
}

/** Recent reports, newest first. In memory only. */
export const reports = (app: App): Report[] => states.get(app)?.reports ?? [];

/** Forgive an IP, in memory and in the stored score. */
export async function release(app: App, ip: string): Promise<void> {
  states.get(app)?.ips.delete(ip);
  const id = await app.db.one`SELECT id FROM log_ip WHERE ip = ${ip}`;
  if (id) await forget(app.db, "log_ip", Number(id));
}
