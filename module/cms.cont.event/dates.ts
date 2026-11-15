import { html } from "@qino/qino";
import { instant, isDate } from "@qino/qino/calendar";

import type { App } from "@qino/qino";
import type { Range } from "@qino/qino/calendar";

// building a formatter costs far more than formatting with it; the same few serve every request
const FORMATS = new Map<string, Intl.DateTimeFormat>();
const format = (lang: string, timeZone: string, time: boolean) => FORMATS.getOrInsertComputed(`${lang} ${timeZone} ${time}`,
  () => new Intl.DateTimeFormat(lang, { dateStyle: "long", ...(time && { timeStyle: "short" }), timeZone }));

/** What a status says, empty while it takes place as planned. */
export function statusText(app: App, status: unknown) {
  const t = app.t.in("cms.cont.event");
  return status === "cancelled" ? t`Cancelled` : status === "postponed" ? t`Postponed` : status === "rescheduled" ? t`Rescheduled` : "";
}

/** Locale-aware date ranges, after their own name if they have one; whole days retain their dates and exclude the stored end date. */
export function formatDates(dates: (Range & { name?: string })[], lang: string, timeZone: string) {
  const days = format(lang, "UTC", false), times = format(lang, timeZone, true);
  return dates.map((date) => {
    const startDay = isDate(date.start), endDay = isDate(date.end);
    const end = endDay ? Temporal.PlainDate.from(date.end).subtract({ days: 1 }).toString() : date.end;
    const from = instant(date.start, "UTC").epochMilliseconds, to = instant(end, "UTC").epochMilliseconds;
    const text = startDay === endDay ? (startDay ? days : times).formatRange(from, to)
      : `${(startDay ? days : times).format(from)} – ${(endDay ? days : times).format(to)}`;
    return html`${date.name ? `${date.name}: ` : ""}<time datetime="${date.start}">${text}</time>`;
  });
}
