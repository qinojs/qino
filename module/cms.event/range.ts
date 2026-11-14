import { sql } from "@qino/qino";
import { dateRange, overlaps } from "@qino/qino/calendar";

import type { Period } from "@qino/qino/calendar";

/** Bound fixed blocks in SQL before resolving their owning nodes. */
export function select(period: Period, nodeId?: number) {
  overlaps(period, period, { timeZone: period.timeZone });
  const instant = (value: string) => /[Tt ]/.test(value) ? Temporal.Instant.from(value)
    : Temporal.PlainDate.from(value).toZonedDateTime(period.timeZone).toInstant();
  const from = instant(period.start), until = instant(period.end);
  const start = Math.floor(from.epochMilliseconds / 1000);
  const end = Math.floor(until.epochMilliseconds / 1000) + (until.epochNanoseconds % 1_000_000_000n ? 1 : 0);
  const days = dateRange({ ...period, start: from.toString(), end: until.toString() });
  const day = (value: string) => Temporal.PlainDate.from(value).toZonedDateTime("UTC").epochMilliseconds / 1000;
  const fields = sql`SELECT id, node_id, ${sql.id("start")}, ${sql.id("end")}, all_day FROM cms_event`;
  const scope = nodeId === undefined ? sql`` : sql`AND node_id = ${nodeId}`;
  return sql`${fields} WHERE all_day = ${false} AND ${sql.id("start")} < ${end} AND ${sql.id("end")} > ${start} ${scope}
    UNION ALL ${fields} WHERE all_day = ${true} AND ${sql.id("start")} < ${day(days.end)} AND ${sql.id("end")} > ${day(days.start)} ${scope}
    ORDER BY ${sql.id("start")}, id`;
}

/** Whole dates use UTC midnight as a storage coordinate, never the viewer's local midnight. */
export function decode(row: Record<string, unknown>) {
  const allDay = row.all_day === true || Number(row.all_day) === 1;
  const value = (time: unknown) => {
    const instant = Temporal.Instant.fromEpochMilliseconds(Number(time) * 1000);
    return allDay ? instant.toZonedDateTimeISO("UTC").toPlainDate().toString() : instant.toString({ smallestUnit: "second" });
  };
  return { start: value(row.start), end: value(row.end) };
}
