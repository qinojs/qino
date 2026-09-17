import { clientIp, Output } from "@qino/qino";
import { hit, scored, scopes, strength } from "@qino/qino/score";

import type { App, Ctx } from "@qino/qino";

const HALF = 3600;     // a suspicion halves every hour
const BLOCK = 50;      // from this strength on, answers are refused; below, they wait strength² ms
const KEEP = 5;        // from this strength on, it is stored
const TRAP = "admin-backup/";
const MAX = 10000;     // tracked IPs before faded ones are swept

type Entry = { s: number; t: number; stored?: boolean };
const states = new WeakMap<App, Map<string, Entry>>();
const now = () => Date.now() / 1000;
const decay = (e: Entry, t: number) => e.s * 2 ** ((e.t - t) / HALF);

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  await scored(app.db, "log_ip", HALF);
  const ips = new Map<string, Entry>();
  states.set(app, ips);

  // Warm the in-memory view from the stored scores, so a restart does not forgive anyone.
  const rows = await app.db.query`SELECT l.ip, s.score FROM score s JOIN log_ip l ON l.id = s.id WHERE s.scope_id = ${scopes(app.db).get("log_ip")!.id}`;
  for (const row of rows) {
    const s = strength(app.db, "log_ip", Number(row.score));
    if (s >= 1) ips.set(String(row.ip), { s, t: now(), stored: true });
  }

  app.on("suspicious", ({ ctx, weight = 1 }) => suspect(ctx, weight), { signal });
  app.on("request-start", ({ request, peerAddr }) => gate(app, clientIp(request, peerAddr, app.trustedProxyHops)), { signal });
  app.on("route", async ({ ctx }) => {
    if (ctx.req.appPath.startsWith(TRAP)) await app.fire("suspicious", { ctx, weight: 3, reason: "robots.txt honeypot" });
  }, { signal });
  app.on("seo:robots", ({ ctx, lines }) => { lines.push(`Disallow: ${ctx.req.appUrl}${TRAP}`); }, { signal });
}

async function suspect(ctx: Ctx, weight: number): Promise<void> {
  const ip = ctx.req.clientIp;
  if (!ip) return;
  const ips = states.get(ctx.app)!;
  const t = now();
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

/** Before any other work, so static files are covered too. */
async function gate(app: App, ip: string): Promise<void> {
  const ips = states.get(app)!;
  const e = ips.get(ip);
  if (!e) return;
  const s = decay(e, now());
  if (s < 1) return void ips.delete(ip);
  const wait = Math.ceil(Math.log2(s / BLOCK) * HALF);
  if (wait >= 0) throw new Output("Too many requests", { status: 429, headers: { "Retry-After": String(wait || 1) } });
  await new Promise((resolve) => setTimeout(resolve, s * s));
}
