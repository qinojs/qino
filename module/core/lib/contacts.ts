import { sql } from "../deps.ts";
import { ApiError } from "./api/errors.ts";
import { unixTime } from "./util.ts";

import type { Db } from "./db/Db.ts";
import type { Row } from "./db/DbDriver.ts";

// Verified ways to reach a user, one table for every kind of address. A row exists only once the
// address was proven, so there is no "verified" column anyone could forget in a WHERE clause.
//
// `type` is what the address *is*, never how it is delivered: one phone number serves sms, whatsapp
// and signal, and nobody should prove the same number once per transport. Which transports exist is
// messaging's business and does not reach this table.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The address kinds core knows how to read. A module may register its own. */
const TYPES: Record<string, (input: string) => string> = {
  email(input) {
    const match = input.match(/^\s*.*?\s*<([^>]+)>\s*$/); // "Name <a@b.ch>" is an address too
    const address = (match?.[1] ?? input).trim().toLowerCase();
    if (!EMAIL_RE.test(address)) throw new ApiError(422, "Use an email address such as name@example.com");
    return address;
  },
  /** E.164, the only notation that travels: local formatting is not an address. */
  phone(input) {
    let number = input.trim().replace(/[\s().-]/g, "");
    if (number.startsWith("00")) number = "+" + number.slice(2);
    if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new ApiError(422, "Use an international phone number such as +41791234567");
    return number;
  },
};

/** The kinds a form may offer, in the order they were registered. */
export function contactTypes(): string[] {
  return Object.keys(TYPES);
}

/**
 * The one form an address is stored and looked up under.
 *
 * Whitespace and case never tell two contacts apart, and a kind that knows more says more:
 * `0041 79 123 45 67` and `+41 79 123 45 67` are one number. An unknown kind keeps the plain form,
 * so a module can hold contacts core has never heard of.
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

/** The one destination to use: the preferred one, else the oldest. */
export function mainContact(db: Db, usrId: number, type: string): Promise<Row | undefined> {
  return db.row`SELECT * FROM usr_contact WHERE usr_id = ${usrId} AND type = ${type}
    ORDER BY main DESC, created, address LIMIT 1`;
}

/** How many addresses of this kind the user has — what a channel's `reach` counts. */
export async function countContacts(db: Db, usrId: number, type: string): Promise<number> {
  return Number(await db.one`SELECT COUNT(*) FROM usr_contact WHERE usr_id = ${usrId} AND type = ${type}`);
}

/** Whose address this is, if anyone's. */
export async function contactOwner(db: Db, type: string, address: string): Promise<number | undefined> {
  return Number(await db.one`SELECT usr_id FROM usr_contact WHERE type = ${type} AND address = ${contactKey(type, address)}`) || undefined;
}

/** The address becomes the user's; the first one of its kind is their main. Taking over someone
 *  else's contact is refused — an address belongs to one person at a time. */
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

/** Forget one contact of the user; the main one hands the flag to the next. */
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

/** Make one contact the user's preferred address of its kind. */
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

/** Every verified address of one kind, with its owner — for the backend panels. */
export function typeContacts(db: Db, type: string, limit = 500): Promise<Row[]> {
  return db.query`
    SELECT c.*, u.email FROM usr_contact c LEFT JOIN usr u ON u.id = c.usr_id
    WHERE c.type = ${type} ORDER BY c.created DESC LIMIT ${limit}`;
}

/** Remember why a delivery failed, or that it works again. */
export function contactError(db: Db, type: string, address: string, error?: string): Promise<unknown> {
  return db.table("usr_contact").update({ type, address: contactKey(type, address) }, { error: error?.slice(0, 255) ?? null });
}
