import { AccessError, ApiError, contactKey, getCtx, safeEqual, sql, unixTime } from "@qino/qino";
import { instants, isDate } from "@qino/qino/calendar";
import { query } from "@qino/qino/cms.event";

import { lock, readable } from "./access.ts";

import type { Period } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

const NAME = "cms.cont.booking";
const START = sql.id("start"), END = sql.id("end"); // "end" is a reserved word in some dialects

/** Each content instance owns an independent appointment calendar. */
export async function slots(node: Node, period: Period) {
  await readable(node);
  const [lower, upper] = instants(period, period.timeZone);
  const now = Temporal.Now.instant();
  const duration = Number(node.settings.duration() ?? 0);
  if (!Number.isSafeInteger(duration) || duration < 0) throw new ApiError(400, "Invalid slot duration");
  const horizon = Number(node.settings.horizon_days() ?? 60);
  if (!Number.isSafeInteger(horizon) || horizon < 1) throw new ApiError(400, "Invalid booking horizon");
  const limit = now.toZonedDateTimeISO(period.timeZone).add({ days: horizon }).toInstant();
  const from = Temporal.Instant.compare(lower, now) < 0 ? now : lower;
  const until = Temporal.Instant.compare(upper, limit) > 0 ? limit : upper;
  if (Temporal.Instant.compare(from, until) >= 0) return [];
  if (from.until(until).total("hours") > 366 * 24) throw new ApiError(400, "Booking query exceeds one year");
  const range = { start: from.toString({ fractionalSecondDigits: 9 }), end: until.toString({ fractionalSecondDigits: 9 }), timeZone: period.timeZone };
  const offers = await query(node, range);
  const result = new Map<string, { dateId: number; start: Temporal.Instant; end: Temporal.Instant }>();
  let count = 0;
  for (const offer of offers) {
    if (isDate(offer.start)) continue;
    const end = Temporal.Instant.from(offer.end);
    let start = Temporal.Instant.from(offer.start);
    if (duration && Temporal.Instant.compare(start, from) < 0) {
      const step = BigInt(duration) * 60_000_000_000n;
      const steps = (from.epochNanoseconds - start.epochNanoseconds + step - 1n) / step;
      start = Temporal.Instant.fromEpochNanoseconds(start.epochNanoseconds + steps * step);
    }
    while (Temporal.Instant.compare(start, end) < 0) {
      if (++count > 10_000) throw new ApiError(400, "Too many booking slots");
      const last = duration ? start.add({ minutes: duration }) : end;
      if (Temporal.Instant.compare(last, end) > 0 || Temporal.Instant.compare(start, until) >= 0) break;
      if (Temporal.Instant.compare(start, from) >= 0)
        result.set(`${start.epochNanoseconds}/${last.epochNanoseconds}`, { dateId: offer.dateId, start, end: last });
      if (!duration) break;
      start = last;
    }
  }
  const candidates = [...result.values()].sort((a, b) => Temporal.Instant.compare(a.start, b.start));
  if (!candidates.length) return [];
  const end = candidates.reduce((last, slot) => Temporal.Instant.compare(slot.end, last) > 0 ? slot.end : last, candidates[0].end);
  // Check complete slots, including the part beyond the requested window.
  const booked = (await node.db.query`SELECT ${START}, ${END} FROM cms_booking
    WHERE node_id = ${node.id} AND cancelled = ${false}
      AND ${START} < ${end.toString({ fractionalSecondDigits: 9 })}
      AND ${END} > ${candidates[0].start.toString({ fractionalSecondDigits: 9 })}`)
    .map((row) => ({ start: Temporal.Instant.from(String(row.start)), end: Temporal.Instant.from(String(row.end)) }))
    .sort((a, b) => Temporal.Instant.compare(a.start, b.start));
  let cursor = 0;
  return candidates.filter((slot) => {
    while (cursor < booked.length && Temporal.Instant.compare(booked[cursor].end, slot.start) <= 0) cursor++;
    return cursor === booked.length || Temporal.Instant.compare(booked[cursor].start, slot.end) >= 0;
  }).map((slot) => ({ dateId: slot.dateId, start: slot.start.toString({ fractionalSecondDigits: 9 }), end: slot.end.toString({ fractionalSecondDigits: 9 }) }));
}

export async function book(node: Node, input: { dateId: number; start: string; name: string; email: string; timeZone: string }) {
  await readable(node);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  let email = "";
  try { email = contactKey("email", input.email); } catch { /* validation below */ }
  if (!name || name.length > 200 || !email || email.length > 254) throw new ApiError(400, "A name and valid email address are required");
  const first = Temporal.Instant.from(input.start);
  const ctx = getCtx();
  const booking = await node.db.transaction(async () => {
    // A database row lock serializes overlapping offers and requests across processes as well.
    await lock(node);
    const available = await slots(node, { start: first.toString(), end: first.add({ nanoseconds: 1 }).toString(), timeZone: input.timeZone });
    const slot = available.find((item) => item.dateId === Number(input.dateId) && Temporal.Instant.from(item.start).equals(first));
    if (!slot) throw new ApiError(409, "This appointment is no longer available");
    // slots() checks the complete appointment while the calendar lock is held.
    const token = crypto.randomUUID();
    const id = await node.db.table("cms_booking").insert({
      node_id: node.id, date_id: slot.dateId, start: slot.start, end: slot.end,
      name, email, usr_id: ctx.userId || null, token, created: unixTime(), cancelled: false,
    });
    return { id: Number(id), token, start: slot.start, end: slot.end };
  });
  const saved = ctx.sess.data[NAME][String(node.id)];
  await saved({ ...(saved() as Record<string, string> | undefined), [booking.id]: booking.token });
  return { id: booking.id, start: booking.start, end: booking.end };
}

/** Only editors, the signed-in owner, or the guest's server-side session can see booking details. */
export async function bookings(node: Node, id?: number) {
  await readable(node);
  const ctx = getCtx(), editor = await node.access() >= 2;
  const saved = ctx.sess.data[NAME][String(node.id)]() as Record<string, string> | undefined;
  const ids = Object.keys(saved ?? {}).map(Number).filter(Number.isSafeInteger);
  if (!editor && !ctx.userId && !ids.length) return [];
  const rows = await node.db.query`SELECT id, ${START}, ${END}, name, email, usr_id, token FROM cms_booking
    WHERE node_id = ${node.id} AND cancelled = ${false}
      ${id === undefined ? sql`` : sql`AND id = ${id}`}
      AND ${editor ? sql`${true}` : sql`(usr_id = ${ctx.userId || null} OR ${sql.in("id", ids)})`}
    ORDER BY ${START}, id`;
  return rows.filter((row) => editor || ctx.userId && Number(row.usr_id) === ctx.userId || safeEqual(saved?.[String(row.id)], row.token))
    .map(({ token: _token, usr_id: _usr, ...row }) => row);
}

export async function cancel(node: Node, id: number) {
  if (!(await bookings(node, id)).length) throw new AccessError();
  await node.db.transaction(async () => {
    await lock(node);
    await node.db.exec`UPDATE cms_booking SET cancelled = ${true} WHERE id = ${id} AND node_id = ${node.id}`;
  });
}
