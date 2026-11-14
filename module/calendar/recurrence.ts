import { RRuleTemporal } from "rrule-temporal";

import { overlaps } from "./mod.ts";

import type { Period, Range } from "./mod.ts";

export type Schedule = Range & { rrule?: string; timeZone?: string; rdate?: string[]; exdate?: string[] };

/** Expand only occurrences overlapping the period. Timed DTEND preserves exact duration (RFC 5545). */
export function occurrences(schedule: Schedule, period: Period): (Range & { recurrenceId: string })[] {
  overlaps(schedule, schedule);
  overlaps(period, period, { timeZone: period.timeZone });
  if (!schedule.rrule && !schedule.rdate?.length && !schedule.exdate?.length)
    return overlaps(schedule, period, { timeZone: period.timeZone }) ? [{ start: schedule.start, end: schedule.end, recurrenceId: schedule.start }] : [];
  const allDay = !/[Tt ]/.test(schedule.start);
  const zone = allDay ? "UTC" : schedule.timeZone ?? (schedule.start.includes("[") ? Temporal.ZonedDateTime.from(schedule.start).timeZoneId : undefined);
  if (!zone) throw new RangeError("calendar: recurring timed entries require a time zone");
  const zoned = (value: string) => {
    if (allDay !== !/[Tt ]/.test(value)) throw new RangeError("calendar: recurrence dates must match the start's date type");
    return allDay ? Temporal.PlainDate.from(value).toZonedDateTime(zone)
      : (value.includes("[") ? Temporal.ZonedDateTime.from(value).toInstant() : Temporal.Instant.from(value)).toZonedDateTimeISO(zone);
  };
  const start = zoned(schedule.start), end = zoned(schedule.end);
  const days = allDay ? start.toPlainDate().until(end.toPlainDate()).days : 0;
  const duration = end.epochNanoseconds - start.epochNanoseconds;
  const from = /[Tt ]/.test(period.start) ? Temporal.Instant.from(period.start)
    : Temporal.PlainDate.from(period.start).toZonedDateTime(period.timeZone).toInstant();
  const until = /[Tt ]/.test(period.end) ? Temporal.Instant.from(period.end)
    : Temporal.PlainDate.from(period.end).toZonedDateTime(period.timeZone).toInstant();
  // Civil dates can occupy 25 hours in the viewer's zone; widen before the final overlap check.
  const lookback = allDay ? BigInt(days + 2) * 86_400_000_000_000n : duration;
  const lower = Temporal.Instant.fromEpochNanoseconds(from.epochNanoseconds - lookback).toZonedDateTimeISO(zone);
  const upper = allDay ? until.toZonedDateTimeISO(zone).add({ days: 2 }) : until.toZonedDateTimeISO(zone);
  const rule = new RRuleTemporal({
    rruleString: allDay ? `DTSTART;VALUE=DATE:${schedule.start.replaceAll("-", "")}\nRRULE:${(schedule.rrule || "FREQ=DAILY;COUNT=1").replace(/^RRULE:/, "")}` : schedule.rrule || "FREQ=DAILY;COUNT=1",
    dtstart: allDay ? undefined : start, temporal: Temporal, strict: true, includeDtstart: true,
    rDate: schedule.rdate?.map(zoned), exDate: schedule.exdate?.map(zoned),
    maxIterations: 10_000, maxCandidateEvaluations: 10_000,
  });
  return rule.between(lower, upper, true).map((date) => {
    const first = allDay ? date.toPlainDate().toString() : date.toInstant().toString({ fractionalSecondDigits: 9 });
    const last = allDay ? date.toPlainDate().add({ days }).toString()
      : Temporal.Instant.fromEpochNanoseconds(date.epochNanoseconds + duration).toString({ fractionalSecondDigits: 9 });
    return { start: first, end: last, recurrenceId: first };
  }).filter((item) => overlaps(item, period, { timeZone: period.timeZone }));
}
