import "@qino/qino";

import type { App, Ctx } from "@qino/qino";

export { occurrences } from "./recurrence.ts";
export type { Schedule } from "./recurrence.ts";

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
  const [start, end] = instants(period, period.timeZone);
  start.toZonedDateTimeISO(period.timeZone);
  const range = { start: start.toString(), end: end.toString(), timeZone: period.timeZone };
  const selected = period.sources;
  if (selected !== undefined && (!Array.isArray(selected) || selected.some((id) => typeof id !== "string")))
    throw new TypeError("calendar: sources must be an array of source IDs");
  return (await Promise.all(linked(ctx.app).filter((mod) => selected === undefined || selected.includes(mod.name)).map(async (mod) => {
    const items = await (mod.plugin.calendar as Source).query(ctx, range);
    return items.filter((item) => overlaps(item, range, { timeZone: period.timeZone }))
      .map((item) => ({ ...item, source: mod.name }));
  }))).flat();
}

const DATE = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}$/;

/** Whether two intervals overlap. Comparing dates with timestamps requires an explicit time zone. */
export function overlaps(a: Range, b: Range, { timeZone }: { timeZone?: string } = {}): boolean {
  if (DATE.test(a.start) && DATE.test(b.start)) {
    const [startA, endA] = dates(a), [startB, endB] = dates(b);
    return Temporal.PlainDate.compare(startA, endB) < 0 && Temporal.PlainDate.compare(startB, endA) < 0;
  }
  const [startA, endA] = instants(a, timeZone), [startB, endB] = instants(b, timeZone);
  return Temporal.Instant.compare(startA, endA) < 0 && Temporal.Instant.compare(startB, endB) < 0
    && Temporal.Instant.compare(startA, endB) < 0 && Temporal.Instant.compare(startB, endA) < 0;
}

function dates(range: Range) {
  if (!DATE.test(range.end)) throw new RangeError("calendar: start and end must both be dates or both timestamps");
  const start = Temporal.PlainDate.from(range.start), end = Temporal.PlainDate.from(range.end);
  if (Temporal.PlainDate.compare(start, end) >= 0) throw new RangeError("calendar: start must precede end");
  return [start, end];
}

function instants(range: Range, timeZone?: string) {
  if (DATE.test(range.start)) {
    const [start, end] = dates(range);
    if (!timeZone) throw new RangeError("calendar: comparing dates with timestamps requires a time zone");
    return [start.toZonedDateTime(timeZone).toInstant(), end.toZonedDateTime(timeZone).toInstant()];
  }
  if (DATE.test(range.end)) throw new RangeError("calendar: start and end must both be dates or both timestamps");
  const start = instant(range.start), end = instant(range.end);
  if (Temporal.Instant.compare(start, end) >= 0) throw new RangeError("calendar: start must precede end");
  return [start, end];
}

const instant = (value: string) => value.includes("[")
  ? Temporal.ZonedDateTime.from(value).toInstant()
  : Temporal.Instant.from(value);
