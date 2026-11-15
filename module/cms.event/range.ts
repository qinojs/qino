import { sql } from "@qino/qino";
import { dateRange, instants, isDate, validateRange } from "@qino/qino/calendar";

import type { Db, Sql } from "@qino/qino";
import type { Period, Range } from "@qino/qino/calendar";

const SECOND = 1_000_000_000n;
const START = sql.id("start"), END = sql.id("end");

/** Whole dates use UTC midnight as a storage coordinate, never the viewer's local midnight. */
const day = (date: string) => Temporal.PlainDate.from(date).toZonedDateTime("UTC").epochMilliseconds / 1000;

/** Storage values of a range; finer than second precision is rejected rather than rounded. */
export function encode(range: Range) {
  validateRange(range);
  if (isDate(range.start)) return { start: day(range.start), end: day(range.end), all_day: true };
  const [start, end] = instants(range).map((time) => {
    if (time.epochNanoseconds % SECOND) throw new RangeError("CMS event blocks use second precision");
    return time.epochMilliseconds / 1000;
  });
  return { start, end, all_day: false };
}

export function decode(seconds: unknown, allDay: unknown) {
  const time = Temporal.Instant.fromEpochMilliseconds(Number(seconds) * 1000);
  return allDay === true || Number(allDay) === 1 ? time.toZonedDateTimeISO("UTC").toPlainDate().toString() : time.toString();
}

export const decodeRow = (row: Record<string, unknown>): Range => ({ start: decode(row.start, row.all_day), end: decode(row.end, row.all_day) });

/** Bound fixed blocks in SQL before resolving their owning nodes. */
export function select(period: Period, nodeId?: number) {
  const [from, until] = instants(period, period.timeZone);
  const start = Math.floor(from.epochMilliseconds / 1000);
  const end = Math.floor(until.epochMilliseconds / 1000) + (until.epochNanoseconds % SECOND ? 1 : 0);
  const days = dateRange({ ...period, start: from.toString(), end: until.toString() });
  const fields = sql`SELECT id, node_id, ${START}, ${END}, all_day FROM cms_event`;
  const scope = nodeId === undefined ? sql`` : sql`AND node_id = ${nodeId}`;
  return sql`${fields} WHERE all_day = ${false} AND ${START} < ${end} AND ${END} > ${start} ${scope}
    UNION ALL ${fields} WHERE all_day = ${true} AND ${START} < ${day(days.end)} AND ${END} > ${day(days.start)} ${scope}
    ORDER BY ${START}, id`;
}

/** Join a paginated node selection (alias `p` in `order`) to at most three block previews per node, in one query. */
export async function overview(db: Db, query: Sql, order: Sql) {
  const rows = await db.query`WITH event_nodes AS (${query}), event_dates AS (
    SELECT e.node_id, e.${START}, e.${END}, e.all_day,
      COUNT(*) OVER (PARTITION BY e.node_id) AS date_count,
      MIN(e.${START}) OVER (PARTITION BY e.node_id) AS period_start,
      MAX(e.${END}) OVER (PARTITION BY e.node_id) AS period_end,
      FIRST_VALUE(e.all_day) OVER (PARTITION BY e.node_id ORDER BY e.${START}, e.id) AS period_start_all_day,
      FIRST_VALUE(e.all_day) OVER (PARTITION BY e.node_id ORDER BY e.${END} DESC, e.id) AS period_end_all_day,
      ROW_NUMBER() OVER (PARTITION BY e.node_id ORDER BY e.${START}, e.id) AS date_rank
    FROM cms_event e JOIN event_nodes p ON p.id = e.node_id
  ) SELECT p.*, e.${START} AS date_start, e.${END} AS date_end, e.all_day AS date_all_day, e.date_count,
      e.period_start, e.period_end, e.period_start_all_day, e.period_end_all_day
    FROM event_nodes p LEFT JOIN event_dates e ON e.node_id = p.id AND e.date_rank <= ${3}
    ORDER BY ${order}, e.date_rank`;
  const items = new Map<number, { row: (typeof rows)[number]; count: number; blocks: Range[]; period?: Range }>();
  for (const row of rows) {
    const id = Number(row.id);
    if (!items.has(id)) items.set(id, { row, count: Number(row.date_count ?? 0), blocks: [] });
    if (row.date_start == null) continue;
    const item = items.get(id)!;
    item.blocks.push({ start: decode(row.date_start, row.date_all_day), end: decode(row.date_end, row.date_all_day) });
    item.period ??= { start: decode(row.period_start, row.period_start_all_day), end: decode(row.period_end, row.period_end_all_day) };
  }
  return [...items.values()];
}
