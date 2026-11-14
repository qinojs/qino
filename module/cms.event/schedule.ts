import { sql } from "@qino/qino";
import { dateRange, overlaps } from "@qino/qino/calendar";

import type { Period, Schedule } from "@qino/qino/calendar";

/** Bound fixed definitions in SQL; recurrence dates are expanded only after checking node access. */
export function within(period: Period) {
  overlaps(period, period, { timeZone: period.timeZone });
  const instant = (value: string) => /[Tt ]/.test(value) ? Temporal.Instant.from(value)
    : Temporal.PlainDate.from(value).toZonedDateTime(period.timeZone).toInstant();
  const start = instant(period.start).toString({ fractionalSecondDigits: 9 });
  const end = instant(period.end).toString({ fractionalSecondDigits: 9 });
  const days = dateRange({ ...period, start, end });
  return sql`((${sql.id("start")} < ${end} AND ${sql.id("end")} > ${start})
    OR (${sql.id("start")} < ${days.end} AND ${sql.id("end")} > ${days.start})
    OR (rrule IS NOT NULL AND ${sql.id("start")} < ${end}) OR rdate IS NOT NULL)`;
}

/** JSON columns are strings in SQLite/MariaDB and parsed values in PostgreSQL/MySQL. */
export function schedule(row: Record<string, unknown>): Schedule {
  const dates = (value: unknown): string[] => typeof value === "string" ? JSON.parse(value) : value as string[] ?? [];
  return {
    start: String(row.start), end: String(row.end),
    ...(row.rrule ? { rrule: String(row.rrule) } : {}), ...(row.time_zone ? { timeZone: String(row.time_zone) } : {}),
    rdate: dates(row.rdate), exdate: dates(row.exdate),
  };
}
