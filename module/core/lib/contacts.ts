import { sql } from "../deps.ts";
import { ApiError } from "./api/errors.ts";
import { unixTime } from "./util.ts";

import type { Db } from "./db/Db.ts";
import type { Row } from "./db/DbDriver.ts";

// Verified addresses of a user, one table for all kinds. A row exists only once verified, so there
// is no "verified" column to forget in a WHERE clause.
//
// `type` is what the address *is*, not how it is delivered: one phone number serves sms, whatsapp and
// signal and is verified once. Transports are messaging's business.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Address kinds core can normalize. Modules may add their own. */
const TYPES: Record<string, (input: string) => string> = {
  email(input) {
    const match = input.match(/^\s*.*?\s*<([^>]+)>\s*$/); // "Name <a@b.ch>" is an address too
    const address = (match?.[1] ?? input).trim().toLowerCase();
    if (!EMAIL_RE.test(address)) throw new ApiError(422, "Use an email address such as name@example.com");
    return address;
  },
  /** E.164, the only unambiguous notation. */
  phone(input) {
    let number = input.trim().replace(/[\s().-]/g, "");
    if (number.startsWith("00")) number = "+" + number.slice(2);
    if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new ApiError(422, "Use an international phone number such as +41791234567");
    return number;
  },
};

/** Kinds a form may offer, in registration order. */
export function contactTypes(): string[] {
  return Object.keys(TYPES);
}

/**
 * The normalized form an address is stored and looked up under.
 *
 * Whitespace and case never matter, and known kinds normalize further: `0041 79 123 45 67` and
 * `+41 79 123 45 67` are one number. Unknown kinds keep the plain form.
 */
export function contactKey(type: string, address: string): string {
  return TYPES[type]?.(address) ?? address.trim().toLowerCase();
}

/** One user's contacts, preferred first. */
export function contacts(db: Db, usrId: number, type?: string): Promise<Row[]> {
  const only = type == null ? sql`` : sql`AND type = ${type}`;
  return db.query`SELECT * FROM usr_contact WHERE usr_id = ${usrId} ${only}
    ORDER BY main DESC, created, address`;
}

/** The address to use: the main one, else the oldest. */
export function mainContact(db: Db, usrId: number, type: string): Promise<Row | undefined> {
  return db.row`SELECT * FROM usr_contact WHERE usr_id = ${usrId} AND type = ${type}
    ORDER BY main DESC, created, address LIMIT 1`;
}

/** Number of addresses of this kind (what a channel's `reach` counts). */
export async function countContacts(db: Db, usrId: number, type: string): Promise<number> {
  return Number(await db.one`SELECT COUNT(*) FROM usr_contact WHERE usr_id = ${usrId} AND type = ${type}`);
}

/** Owner of the address, if any. */
export async function contactOwner(db: Db, type: string, address: string): Promise<number | undefined> {
  return Number(await db.one`SELECT usr_id FROM usr_contact WHERE type = ${type} AND address = ${contactKey(type, address)}`) || undefined;
}

/** Add the address to the user; the first of its kind becomes main. Refused if another user has
 *  it — an address belongs to one person. */
export async function addContact(db: Db, usrId: number, type: string, input: string): Promise<Row> {
  const address = contactKey(type, input);
  await db.transaction(async () => {
    const owner = await contactOwner(db, type, address);
    if (owner && owner !== usrId) throw new ApiError(409, "Address is unavailable");
    if (owner) return;
    const main = !await mainContact(db, usrId, type);
    await db.table("usr_contact").insert({ type, address, usr_id: usrId, created: unixTime(), main });
  });
  return (await db.row`SELECT * FROM usr_contact WHERE type = ${type} AND address = ${address}`)!;
}

/** Remove a contact; if it was main, the next one becomes main. */
export async function removeContact(db: Db, usrId: number, type: string, input: string): Promise<void> {
  const address = contactKey(type, input);
  await db.transaction(async () => {
    const row = await db.row`SELECT main FROM usr_contact
      WHERE type = ${type} AND address = ${address} AND usr_id = ${usrId}`;
    if (!row) return;
    await db.exec`DELETE FROM usr_contact WHERE type = ${type} AND address = ${address}`;
    if (!row.main) return;
    const next = await mainContact(db, usrId, type);
    if (next) await db.table("usr_contact").update({ type, address: next.address }, { main: true });
  });
}

/** Make a contact the user's main address of its kind. */
export async function setMainContact(db: Db, usrId: number, type: string, input: string): Promise<Row> {
  const address = contactKey(type, input);
  await db.transaction(async () => {
    const row = await db.row`SELECT address FROM usr_contact
      WHERE type = ${type} AND address = ${address} AND usr_id = ${usrId}`;
    if (!row) throw new ApiError(404, "Contact not found");
    await db.exec`UPDATE usr_contact SET main = ${false} WHERE usr_id = ${usrId} AND type = ${type}`;
    await db.table("usr_contact").update({ type, address }, { main: true });
  });
  return (await db.row`SELECT * FROM usr_contact WHERE type = ${type} AND address = ${address}`)!;
}

/** All addresses of one kind with their owner — for backend panels. */
export function typeContacts(db: Db, type: string, limit = 500): Promise<Row[]> {
  return db.query`
    SELECT c.*, u.username FROM usr_contact c LEFT JOIN usr u ON u.id = c.usr_id
    WHERE c.type = ${type} ORDER BY c.created DESC LIMIT ${limit}`;
}

/** Store why a delivery failed, or clear it. */
export function contactError(db: Db, type: string, address: string, error?: string): Promise<unknown> {
  return db.table("usr_contact").update({ type, address: contactKey(type, address) }, { error: error?.slice(0, 255) ?? null });
}
