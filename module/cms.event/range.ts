import { ApiError, sql } from "@qino/qino";
import { dateRange, instants, isDate, validateRange } from "@qino/qino/calendar";

import type { Db, Row, Sql } from "@qino/qino";
import type { Period, Range } from "@qino/qino/calendar";

const SECOND = 1_000_000_000n;
const START = sql.id("start"), END = sql.id("end");

/** Whole dates use UTC midnight as a storage coordinate, never the viewer's local midnight. */
const day = (date: string) => Temporal.PlainDate.from(date).toZonedDateTime("UTC").epochMilliseconds / 1000;

/** A displayed price: zero or more, or none. */
export const amount = (v: unknown) => {
  if (v === null || typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  throw new ApiError(400, "A price is zero or more, or none");
};

/** A date as given: its range, and optionally its own name and price. */
export type EventDate = Range & { name?: string; price?: number | null };

/** Storage values of a date; finer than second precision is rejected rather than rounded. */
export function encode(date: EventDate) {
  validateRange(date);
  const { name = "", price = null } = date;
  if (typeof name !== "string") throw new RangeError("CMS event date names are text");
  const own = { name: name.trim(), price: amount(price) };
  if (isDate(date.start)) return { start: day(date.start), end: day(date.end), all_day: true, ...own };
  const [start, end] = instants(date).map((time) => {
    if (time.epochNanoseconds % SECOND) throw new RangeError("CMS event dates use second precision");
    return time.epochMilliseconds / 1000;
  });
  return { start, end, all_day: false, ...own };
}

export function decode(seconds: unknown, allDay: unknown) {
  const time = Temporal.Instant.fromEpochMilliseconds(Number(seconds) * 1000);
  return allDay === true || Number(allDay) === 1 ? time.toZonedDateTimeISO("UTC").toPlainDate().toString() : time.toString();
}

export const decodeRow = (row: Row): EventDate => ({
  start: decode(row.start, row.all_day), end: decode(row.end, row.all_day), name: String(row.name ?? ""), price: row.price == null ? null : Number(row.price),
});

/** Bound the dates in SQL before resolving their events' nodes. A moment (start = end) is in the period with its start. */
export function select(period: Period, eventId?: number) {
  const [from, until] = instants(period, period.timeZone);
  const start = Math.floor(from.epochMilliseconds / 1000);
  const end = Math.floor(until.epochMilliseconds / 1000) + (until.epochNanoseconds % SECOND ? 1 : 0);
  const days = dateRange({ ...period, start: from.toString(), end: until.toString() });
  // the event's status comes along, for whoever shows the date
  // named, as a UNION orders by the columns of its result
  const fields = sql`SELECT d.id AS id, d.event_id AS event_id, d.${START} AS ${START}, d.${END} AS ${END}, d.all_day AS all_day,
    d.name AS name, d.price AS price, ev.status AS status FROM cms_event_date d JOIN cms_event ev ON ev.id = d.event_id`;
  const scope = eventId === undefined ? sql`` : sql`AND event_id = ${eventId}`;
  return sql`${fields} WHERE all_day = ${false} AND ${START} < ${end} AND (${END} > ${start} OR ${START} >= ${start}) ${scope}
    UNION ALL ${fields} WHERE all_day = ${true} AND ${START} < ${day(days.end)} AND ${END} > ${day(days.start)} ${scope}
    ORDER BY ${START}, id`;
}

/** Storage value from which on dates count as still ahead: ending then or later (a moment: starting). */
export const ahead = (from: Temporal.Instant) => Math.floor(from.epochMilliseconds / 1000);

/** Join a paginated selection of events (`event_nodes`, alias `p` in `order`: page rows joined to
 *  cms_event) to at most three date previews each, a total count and the period they span; with
 *  `from`, only dates still ahead then. The event's row comes along: one query for the page. */
export async function overview(db: Db, query: Sql, order: Sql, { from }: { from?: Temporal.Instant } = {}) {
  const rows = await db.query`WITH event_nodes AS (${query}), event_dates AS (
    SELECT e.event_id, e.${START}, e.${END}, e.all_day, e.name, e.price,
      COUNT(*) OVER (PARTITION BY e.event_id) AS date_count,
      MIN(e.${START}) OVER (PARTITION BY e.event_id) AS period_start,
      MAX(e.${END}) OVER (PARTITION BY e.event_id) AS period_end,
      FIRST_VALUE(e.all_day) OVER (PARTITION BY e.event_id ORDER BY e.${START}, e.id) AS period_start_all_day,
      FIRST_VALUE(e.all_day) OVER (PARTITION BY e.event_id ORDER BY e.${END} DESC, e.id) AS period_end_all_day,
      ROW_NUMBER() OVER (PARTITION BY e.event_id ORDER BY e.${START}, e.id) AS date_rank
    FROM cms_event_date e JOIN event_nodes p ON p.id = e.event_id ${from ? sql`WHERE e.${END} >= ${ahead(from)}` : sql``}
  ) SELECT p.*, ${sql.join(EVENT_FIELDS.map((f) => sql`ev.${sql.id(f)} AS ${sql.id(`event_${f}`)}`), ", ")},
      e.${START} AS date_start, e.${END} AS date_end, e.all_day AS date_all_day, e.name AS date_name, e.price AS date_price, e.date_count,
      e.period_start, e.period_end, e.period_start_all_day, e.period_end_all_day
    FROM event_nodes p JOIN cms_event ev ON ev.id = p.id LEFT JOIN event_dates e ON e.event_id = p.id AND e.date_rank <= ${3}
    ORDER BY ${order}, e.date_rank`;
  const items = new Map<number, { row: Row; event: Row; count: number; dates: EventDate[]; period?: Range }>();
  for (const row of rows) {
    const id = Number(row.id);
    if (!items.has(id)) {
      const event = Object.fromEntries(EVENT_FIELDS.map((f) => [f, row[`event_${f}`]]));
      items.set(id, { row, event: { id, ...event }, count: Number(row.date_count ?? 0), dates: [] });
    }
    if (row.date_start == null) continue;
    const item = items.get(id)!;
    item.dates.push(decodeRow({ start: row.date_start, end: row.date_end, all_day: row.date_all_day, name: row.date_name, price: row.date_price }));
    item.period ??= { start: decode(row.period_start, row.period_start_all_day), end: decode(row.period_end, row.period_end_all_day) };
  }
  return [...items.values()];
}

/** The columns of an event besides its id. */
export const EVENT_FIELDS = ["time_zone", "address_street", "address_postal_code", "address_locality", "address_country",
  "price", "currency", "performer", "language", "external_link", "status", "online_url"] as const;
