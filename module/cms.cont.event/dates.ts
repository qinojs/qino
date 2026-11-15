import { html } from "@qino/qino";
import { instant, isDate } from "@qino/qino/calendar";

import type { Range } from "@qino/qino/calendar";

// building a formatter costs far more than formatting with it; the same few serve every request
const FORMATS = new Map<string, Intl.DateTimeFormat>();
const format = (lang: string, timeZone: string, time: boolean) => FORMATS.getOrInsertComputed(`${lang} ${timeZone} ${time}`,
  () => new Intl.DateTimeFormat(lang, { dateStyle: "long", ...(time && { timeStyle: "short" }), timeZone }));

/** Locale-aware date ranges; whole days retain their dates and exclude the stored end date. */
export function formatDates(dates: Range[], lang: string, timeZone: string) {
  const days = format(lang, "UTC", false), times = format(lang, timeZone, true);
  return dates.map((date) => {
    const startDay = isDate(date.start), endDay = isDate(date.end);
    const end = endDay ? Temporal.PlainDate.from(date.end).subtract({ days: 1 }).toString() : date.end;
    const from = instant(date.start, "UTC").epochMilliseconds, to = instant(end, "UTC").epochMilliseconds;
    const text = startDay === endDay ? (startDay ? days : times).formatRange(from, to)
      : `${(startDay ? days : times).format(from)} – ${(endDay ? days : times).format(to)}`;
    return html`<time datetime="${date.start}">${text}</time>`;
  });
}
