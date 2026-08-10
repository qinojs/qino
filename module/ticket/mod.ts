// Public API of ticket. The qino plugin lives in ./plugin.ts.

import { ApiError, randB64, requestStorage, sha256b64url, unixTime, type App } from "../core/mod.ts";

/** A kind of ticket, declared by a module as `export const tickets` keyed by purpose. */
export type TicketKind = {
  ttl?: number | null;
  uses?: number;
  /** What holding the ticket entitles you to: the payload it was issued with, plus what the redeemer brings. */
  redeem?(app: App, ticket: Ticket, input?: unknown): unknown;
};

export type Ticket = { purpose: string; data: unknown; expires?: number; created: number };

const TTL = 24 * 60 * 60;

// A purpose is global — prefix it with the module that declares it.
function kindOf(app: App, purpose: string): TicketKind {
  for (const mod of Object.values(app.modules.all())) {
    const kind = mod.plugin.tickets?.[purpose];
    if (kind && app.modules.linked(mod.name)) return kind;
  }
  throw new Error(`ticket: no kind "${purpose}" — declare it in a module's tickets export`);
}

/** Issue a ticket. The handle it resolves with is the whole secret — hand it to one person only. */
export async function issue(app: App, purpose: string, data?: unknown): Promise<string> {
  const kind = kindOf(app, purpose);
  const now = unixTime();
  const handle = randB64(32);
  await app.db.table("ticket").insert({
    hash: await sha256b64url(handle),
    purpose,
    data: JSON.stringify(data ?? null),
    expires: kind.ttl === null ? null : now + (kind.ttl ?? TTL),
    uses: kind.uses ?? 1,
    used: 0,
    created: now,
    log_id: await requestStorage.getStore()?.logId ?? null,
  });
  return handle;
}

/** What the handle stands for while it still works — a look that spends nothing. */
export async function check(app: App, handle: string): Promise<Ticket | undefined> {
  const row = await app.db.row`SELECT * FROM ticket WHERE hash = ${await sha256b64url(handle)}`;
  if (!row || Number(row.used) >= Number(row.uses)) return;
  if (row.expires != null && Number(row.expires) < unixTime()) return;
  return {
    purpose: String(row.purpose),
    data: JSON.parse(String(row.data ?? "null")),
    expires: row.expires == null ? undefined : Number(row.expires),
    created: Number(row.created),
  };
}

/** Spend it and resolve with what the kind's `redeem` returned — the ticket itself when it declares none. */
export async function redeem(app: App, handle: string, input?: unknown): Promise<unknown> {
  const ticket = await check(app, handle);
  if (!ticket) throw new ApiError(404, "Nothing to redeem");
  // one statement, so two parallel redemptions cannot both pass — and before the handler, so one
  // that throws leaves the ticket spent rather than reusable
  const spent = await app.db.exec`UPDATE ticket SET used = used + 1 WHERE hash = ${await sha256b64url(handle)} AND used < uses`;
  if (!spent?.affectedRows) throw new ApiError(404, "Nothing to redeem");
  return await kindOf(app, ticket.purpose).redeem?.(app, ticket, input) ?? ticket;
}
