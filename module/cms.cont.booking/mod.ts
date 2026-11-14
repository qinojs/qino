import { AccessError, ApiError, contactKey, getCtx, safeEqual, sql, unixTime } from "@qino/qino";
import { overlaps } from "@qino/qino/calendar";
import { query } from "@qino/qino/cms.event";

import { lock, readable } from "./access.ts";

import type { Period } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

const NAME = "cms.cont.booking";

/** Each content instance owns an independent appointment calendar. */
export async function slots(node: Node, period: Period) {
  await readable(node);
  overlaps(period, period, { timeZone: period.timeZone });
  const now = Temporal.Now.instant();
  const duration = Number(node.settings.duration() ?? 0);
  if (!Number.isSafeInteger(duration) || duration < 0) throw new ApiError(400, "Invalid slot duration");
  const horizon = Number(node.settings.horizon_days() ?? 60);
  if (!Number.isSafeInteger(horizon) || horizon < 1) throw new ApiError(400, "Invalid booking horizon");
  const limit = now.toZonedDateTimeISO(period.timeZone).add({ days: horizon }).toInstant();
  const instant = (value: string) => /[Tt ]/.test(value) ? Temporal.Instant.from(value)
    : Temporal.PlainDate.from(value).toZonedDateTime(period.timeZone).toInstant();
  const from = Temporal.Instant.compare(instant(period.start), now) < 0 ? now : instant(period.start);
  const until = Temporal.Instant.compare(instant(period.end), limit) > 0 ? limit : instant(period.end);
  if (Temporal.Instant.compare(from, until) >= 0) return [];
  if (from.until(until).total("hours") > 366 * 24) throw new ApiError(400, "Booking query exceeds one year");
  const range = { start: from.toString({ fractionalSecondDigits: 9 }), end: until.toString({ fractionalSecondDigits: 9 }), timeZone: period.timeZone };
  const offers = await query(node, range);
  const booked = await node.db.query`SELECT ${sql.id("start")}, ${sql.id("end")} FROM cms_booking
    WHERE node_id = ${node.id} AND cancelled = ${false} AND ${sql.id("start")} < ${range.end} AND ${sql.id("end")} > ${range.start}`;
  const result = new Map<string, { eventId: number; start: string; end: string }>();
  let count = 0;
  for (const offer of offers) {
    if (!/[Tt ]/.test(offer.start)) continue;
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
      const slot = { eventId: offer.eventId, start: start.toString({ fractionalSecondDigits: 9 }), end: last.toString({ fractionalSecondDigits: 9 }) };
      if (Temporal.Instant.compare(start, from) >= 0 && !booked.some((item) => overlaps(slot, { start: String(item.start), end: String(item.end) })))
        result.set(`${slot.start}/${slot.end}`, slot);
      if (!duration) break;
      start = last;
    }
  }
  return [...result.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export async function book(node: Node, input: { eventId: number; start: string; name: string; email: string; timeZone: string }) {
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
    const slot = available.find((item) => item.eventId === Number(input.eventId) && Temporal.Instant.from(item.start).equals(first));
    if (!slot) throw new ApiError(409, "This appointment is no longer available");
    // The tiny lookup window may not contain a booking that starts later inside this slot.
    const conflict = await node.db.one`SELECT id FROM cms_booking WHERE node_id = ${node.id} AND cancelled = ${false}
      AND ${sql.id("start")} < ${slot.end} AND ${sql.id("end")} > ${slot.start} LIMIT 1`;
    if (conflict) throw new ApiError(409, "This appointment is no longer available");
    const token = crypto.randomUUID();
    const id = await node.db.table("cms_booking").insert({
      node_id: node.id, event_id: slot.eventId, start: slot.start, end: slot.end,
      name, email, usr_id: ctx.userId || null, token, created: unixTime(), cancelled: false,
    });
    return { id: Number(id), token, start: slot.start, end: slot.end };
  });
  const saved = ctx.sess.data[NAME][String(node.id)];
  await saved({ ...(saved() as Record<string, string> | undefined), [booking.id]: booking.token });
  return { id: booking.id, start: booking.start, end: booking.end };
}

/** Only editors, the signed-in owner, or the guest's server-side session can see booking details. */
export async function bookings(node: Node) {
  await readable(node);
  const ctx = getCtx(), editor = await node.access() >= 2;
  const saved = ctx.sess.data[NAME][String(node.id)]() as Record<string, string> | undefined;
  const ids = Object.keys(saved ?? {}).map(Number).filter(Number.isSafeInteger);
  if (!editor && !ctx.userId && !ids.length) return [];
  const rows = await node.db.query`SELECT id, ${sql.id("start")}, ${sql.id("end")}, name, email, usr_id, token FROM cms_booking
    WHERE node_id = ${node.id} AND cancelled = ${false}
      AND ${editor ? sql`${true}` : sql`(usr_id = ${ctx.userId || null} OR ${sql.in("id", ids)})`}
    ORDER BY ${sql.id("start")}, id`;
  return rows.filter((row) => editor || ctx.userId && Number(row.usr_id) === ctx.userId || safeEqual(saved?.[String(row.id)], row.token))
    .map(({ token: _token, usr_id: _usr, ...row }) => row);
}

export async function cancel(node: Node, id: number) {
  await readable(node);
  if (!(await bookings(node)).some((row) => Number(row.id) === id)) throw new AccessError();
  await node.db.transaction(async () => {
    await lock(node);
    await node.db.exec`UPDATE cms_booking SET cancelled = ${true} WHERE id = ${id} AND node_id = ${node.id}`;
  });
}
