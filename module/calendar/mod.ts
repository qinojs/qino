import "@qino/qino";

import type { App, Ctx } from "@qino/qino";

export { occurrences } from "./recurrence.ts";

/** A half-open interval: dates for all-day entries, offset timestamps for timed entries. */
export type Range = { start: string; end: string };

export type Period = Range & { timeZone: string };
export type Entry = Range & { id: string; title: string; url?: string; editUrl?: string };
export type Source = { title?: string | Record<string, string>; color?: string; query(ctx: Ctx, period: Period): Promise<Entry[]> };

const linked = (app: App) => app.modules.linked().filter((mod) => typeof mod.plugin.calendar?.query === "function");

/** Available sources; choosing one never bypasses the source's own permissions. */
export function sources(app: App, lang = app.languages.def): { id: string; title: string; color?: string }[] {
  return linked(app).map((mod) => {
    const { title, color } = mod.plugin.calendar as Source;
    return { id: mod.name, title: typeof title === "string" ? title : title?.[lang] ?? title?.[app.languages.def] ?? Object.values(title ?? {})[0] ?? mod.name, ...(color && { color }) };
  });
}

/** Calendar dates touched by an exact period, with an exclusive end in the viewer's time zone. */
export function dateRange(period: Period): Range {
  const start = Temporal.Instant.from(period.start).toZonedDateTimeISO(period.timeZone);
  const end = Temporal.Instant.from(period.end).toZonedDateTimeISO(period.timeZone);
  return {
    start: start.toPlainDate().toString(),
    end: end.toPlainDate().add({ days: end.toPlainTime().equals("00:00") ? 0 : 1 }).toString(),
  };
}

/** Read linked sources in the caller's context; failures propagate instead of hiding missing entries. */
export async function entries(ctx: Ctx, period: Period & { sources?: string[] }): Promise<(Entry & { source: string })[]> {
  const { timeZone, sources: selected } = period, [start, end] = instants(period, timeZone);
  start.toZonedDateTimeISO(timeZone); // rejects an unknown time zone
  const range = { start: start.toString(), end: end.toString(), timeZone };
  const mods = linked(ctx.app).filter((mod) => !selected || selected.includes(mod.name));
  return (await Promise.all(mods.map(async (mod) => {
    const items = await (mod.plugin.calendar as Source).query(ctx, range);
    return items.filter((item) => overlaps(item, range, { timeZone })).map((item) => ({ ...item, source: mod.name }));
  }))).flat();
}

const DATE = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}$/;

/** Whether a boundary is a whole date (`YYYY-MM-DD`) rather than a timestamp. */
export const isDate = (value: string): boolean => DATE.test(value);

/** The exact instant of a timestamp, or of a date's first moment in the time zone. */
export function instant(value: string, timeZone?: string): Temporal.Instant {
  if (!isDate(value)) return value.includes("[") ? Temporal.ZonedDateTime.from(value).toInstant() : Temporal.Instant.from(value);
  if (!timeZone) throw new RangeError("calendar: comparing dates with timestamps requires a time zone");
  return Temporal.PlainDate.from(value).toZonedDateTime(timeZone).toInstant();
}

/** Throws unless both bounds are dates or both timestamps, and the start precedes the end. */
export function validateRange(range: Range): void {
  const dates = isDate(range.start);
  if (dates !== isDate(range.end)) throw new RangeError("calendar: start and end must both be dates or both timestamps");
  const order = dates ? Temporal.PlainDate.compare(range.start, range.end) : Temporal.Instant.compare(instant(range.start), instant(range.end));
  if (order >= 0) throw new RangeError("calendar: start must precede end");
}

/** Exact bounds of a valid range; dates begin with their first moment in the time zone. */
export function instants(range: Range, timeZone?: string): [Temporal.Instant, Temporal.Instant] {
  validateRange(range);
  return [instant(range.start, timeZone), instant(range.end, timeZone)];
}

/** Whether two intervals overlap. Comparing dates with timestamps requires an explicit time zone. */
export function overlaps(a: Range, b: Range, { timeZone }: { timeZone?: string } = {}): boolean {
  if (isDate(a.start) && isDate(b.start)) {
    validateRange(a);
    validateRange(b);
    return Temporal.PlainDate.compare(a.start, b.end) < 0 && Temporal.PlainDate.compare(b.start, a.end) < 0;
  }
  const [startA, endA] = instants(a, timeZone), [startB, endB] = instants(b, timeZone);
  // a date its time zone skips entirely is empty there
  return Temporal.Instant.compare(startA, endA) < 0 && Temporal.Instant.compare(startB, endB) < 0
    && Temporal.Instant.compare(startA, endB) < 0 && Temporal.Instant.compare(startB, endA) < 0;
}

/** A date or exact timestamp as given; a local date-time is read in the time zone, where skipped and repeated wall times throw. */
export const exact = (value: string, timeZone: string): string => isDate(value) || /(?:Z|[+-]\d\d:\d\d|\])$/i.test(value) ? value
  : Temporal.PlainDateTime.from(value).toZonedDateTime(timeZone, { disambiguation: "reject" }).toInstant().toString();

/** Local date-time of a timestamp in the time zone, as `datetime-local` inputs take it. */
export const toLocal = (value: string, timeZone: string): string =>
  instant(value).toZonedDateTimeISO(timeZone).toPlainDateTime().toString({ smallestUnit: "second" });
