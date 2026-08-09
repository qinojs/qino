// Public API of ticket. The qino plugin lives in ./plugin.ts.

import { ApiError, randB64, requestStorage, sha256b64url, unixTime, type App, type Row } from "../core/mod.ts";

/**
 * A kind of ticket, declared by a module as `export const tickets` keyed by purpose.
 *
 * `redeem` is what holding the ticket entitles you to. It gets the payload the ticket was issued
 * with, plus whatever the redeemer supplies now — a reset link knows the user, but not the new
 * password until someone types it.
 */
export type TicketKind = {
  ttl?: number | null;
  uses?: number;
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

/**
 * Issue a ticket and resolve with its handle — the only moment it exists in the clear.
 * Whoever knows the handle may redeem it, so hand it out to that one person and no one else.
 */
export async function issue(app: App, purpose: string, data?: unknown): Promise<string> {
  const kind = kindOf(app, purpose);
  const now = unixTime();
  await app.db.exec`DELETE FROM ticket WHERE expires < ${now}`; // no cron needed for this
  const handle = randB64(32);
  await app.db.table("ticket").insert({
    hash: await hash(app, handle),
    purpose,
    data: JSON.stringify(data ?? null),
    expires: kind.ttl === null ? null : now + (kind.ttl ?? TTL),
    uses: kind.uses ?? 1,
    created: now,
    log_id: await requestStorage.getStore()?.logId ?? null,
  });
  return handle;
}

/** What the handle stands for, or undefined — a look that spends nothing, for the page behind a link. */
export async function check(app: App, handle: string, purpose?: string): Promise<Ticket | undefined> {
  const row = await find(app, handle);
  return row && (purpose == null || row.purpose === purpose) ? ticketOf(row) : undefined;
}

/**
 * Spend the ticket and resolve with what its kind's `redeem` returned — the ticket itself when it
 * declares none. Throws when the handle stands for nothing.
 *
 * Never from a GET: mail scanners and link checkers open every URL they are sent, and the ticket
 * would be gone before its owner clicks. The link shows a page, the page redeems.
 */
export async function redeem(app: App, handle: string, o: { purpose?: string; input?: unknown } = {}): Promise<unknown> {
  const row = await find(app, handle);
  if (!row || (o.purpose != null && row.purpose !== o.purpose)) throw new ApiError(404, "Nothing to redeem");
  const left = Number(row.uses) - 1;
  left > 0
    ? await app.db.table("ticket").update(row.hash, { uses: left })
    : await drop(app, row);
  const ticket = ticketOf(row);
  return await kindOf(app, ticket.purpose).redeem?.(app, ticket, o.input) ?? ticket;
}

async function find(app: App, handle: string): Promise<Row | undefined> {
  const row = await app.db.row`SELECT * FROM ticket WHERE hash = ${await hash(app, handle)}`;
  if (!row) return;
  if (row.expires == null || Number(row.expires) >= unixTime()) return row;
  await drop(app, row);
}

function drop(app: App, row: Row) {
  return app.db.exec`DELETE FROM ticket WHERE hash = ${row.hash}`;
}

function ticketOf(row: Row): Ticket {
  return {
    purpose: String(row.purpose),
    data: JSON.parse(String(row.data ?? "null")),
    expires: row.expires == null ? undefined : Number(row.expires),
    created: Number(row.created),
  };
}

// A handle is 32 random bytes, so nothing but knowing it finds the row. It is stored keyed-hashed
// all the same: a database that leaks must not hand out working capabilities. The key is made on
// first use and never again — replacing it would invalidate every outstanding ticket.
async function hash(app: App, handle: string): Promise<string> {
  let key = String(await app.settings.ticket._secret ?? "");
  if (!key) await app.settings.ticket._secret(key = randB64(32));
  return sha256b64url(`${key}\0${handle}`);
}
