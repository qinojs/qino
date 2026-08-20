import { sql } from "../deps.ts";
import { ApiError } from "./api/errors.ts";
import { unixTime } from "./util.ts";

import type { Db } from "./db/Db.ts";
import type { Row } from "./db/DbDriver.ts";

// Verified ways to reach a user, one table for every channel. A row exists only once the address
// was proven, so there is no "verified" column anyone could forget in a WHERE clause — the same
// property `usr_contact_verification` gives the claims it holds until then.

/** Whitespace and case never tell two contacts apart: every address kind this table holds — mail,
 *  E.164 — is case-insensitive, and every path that writes one lowercases anyway. A channel with
 *  case-sensitive addresses would have to say so before it could live here. The canonical form
 *  beyond this (`+41…` out of `0041 …`) is the channel's `normalize()`, applied before this. */
export const contactKey = (address: string): string => address.trim().toLowerCase();
const key = contactKey;

/** One user's contacts, preferred first. */
export function contacts(db: Db, usrId: number, channel?: string): Promise<Row[]> {
  const only = channel == null ? sql`` : sql`AND channel = ${channel}`;
  return db.query`SELECT * FROM usr_contact WHERE usr_id = ${usrId} ${only}
    ORDER BY main DESC, created, address`;
}

/** The one destination to use: the preferred one, else the oldest. */
export function mainContact(db: Db, usrId: number, channel: string): Promise<Row | undefined> {
  return db.row`SELECT * FROM usr_contact WHERE usr_id = ${usrId} AND channel = ${channel}
    ORDER BY main DESC, created, address LIMIT 1`;
}

/** How many destinations this user has — what a channel's `reach` answers. */
export async function countContacts(db: Db, usrId: number, channel: string): Promise<number> {
  return Number(await db.one`SELECT COUNT(*) FROM usr_contact WHERE usr_id = ${usrId} AND channel = ${channel}`);
}

/** Whose address this is, if anyone's. */
export async function contactOwner(db: Db, channel: string, address: string): Promise<number | undefined> {
  return Number(await db.one`SELECT usr_id FROM usr_contact WHERE channel = ${channel} AND address = ${key(address)}`) || undefined;
}

/** The address becomes the user's; the first one on a channel is their main. Taking over someone
 *  else's contact is refused — an address belongs to one person at a time. */
export async function addContact(db: Db, usrId: number, channel: string, input: string): Promise<Row> {
  const address = key(input);
  await db.transaction(async () => {
    const owner = await contactOwner(db, channel, address);
    if (owner && owner !== usrId) throw new ApiError(409, "Address is unavailable");
    if (owner) return;
    const main = !await mainContact(db, usrId, channel);
    await db.table("usr_contact").insert({ channel, address, usr_id: usrId, created: unixTime(), main });
  });
  return (await db.row`SELECT * FROM usr_contact WHERE channel = ${channel} AND address = ${address}`)!;
}

/** Forget one contact of the user; the main one hands the flag to the next. */
export async function removeContact(db: Db, usrId: number, channel: string, input: string): Promise<void> {
  const address = key(input);
  await db.transaction(async () => {
    const row = await db.row`SELECT main FROM usr_contact
      WHERE channel = ${channel} AND address = ${address} AND usr_id = ${usrId}`;
    if (!row) return;
    await db.exec`DELETE FROM usr_contact WHERE channel = ${channel} AND address = ${address}`;
    if (!row.main) return;
    const next = await mainContact(db, usrId, channel);
    if (next) await db.table("usr_contact").update({ channel, address: next.address }, { main: true });
  });
}

/** Make one contact the user's preferred destination on its channel. */
export async function setMainContact(db: Db, usrId: number, channel: string, input: string): Promise<Row> {
  const address = key(input);
  await db.transaction(async () => {
    const row = await db.row`SELECT address FROM usr_contact
      WHERE channel = ${channel} AND address = ${address} AND usr_id = ${usrId}`;
    if (!row) throw new ApiError(404, "Contact not found");
    await db.exec`UPDATE usr_contact SET main = ${false} WHERE usr_id = ${usrId} AND channel = ${channel}`;
    await db.table("usr_contact").update({ channel, address }, { main: true });
  });
  return (await db.row`SELECT * FROM usr_contact WHERE channel = ${channel} AND address = ${address}`)!;
}

/** Every verified contact on one channel, with its owner — for the backend panels. */
export function channelContacts(db: Db, channel: string, limit = 500): Promise<Row[]> {
  return db.query`
    SELECT c.*, u.email FROM usr_contact c LEFT JOIN usr u ON u.id = c.usr_id
    WHERE c.channel = ${channel} ORDER BY c.created DESC LIMIT ${limit}`;
}

/** Remember why a delivery failed, or that it works again. */
export function contactError(db: Db, channel: string, address: string, error?: string): Promise<unknown> {
  return db.table("usr_contact").update({ channel, address: key(address) }, { error: error?.slice(0, 255) ?? null });
}
