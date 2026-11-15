import { html } from "@qino/qino";
import { instant, isDate } from "@qino/qino/calendar";

import type { Range } from "@qino/qino/calendar";

// building a formatter costs far more than formatting with it; the same few serve every request
const FORMATS = new Map<string, Intl.DateTimeFormat>();
const format = (lang: string, timeZone: string, time: boolean) => FORMATS.getOrInsertComputed(`${lang} ${timeZone} ${time}`,
  () => new Intl.DateTimeFormat(lang, { dateStyle: "long", ...(time && { timeStyle: "short" }), timeZone }));

/** Locale-aware date ranges; whole days retain their dates and exclude the stored end date. */
export function formatDates(blocks: Range[], lang: string, timeZone: string) {
  const dates = format(lang, "UTC", false), times = format(lang, timeZone, true);
  return blocks.map((block) => {
    const startDay = isDate(block.start), endDay = isDate(block.end);
    const end = endDay ? Temporal.PlainDate.from(block.end).subtract({ days: 1 }).toString() : block.end;
    const from = instant(block.start, "UTC").epochMilliseconds, to = instant(end, "UTC").epochMilliseconds;
    const text = startDay === endDay ? (startDay ? dates : times).formatRange(from, to)
      : `${(startDay ? dates : times).format(from)} – ${(endDay ? dates : times).format(to)}`;
    return html`<time datetime="${block.start}">${text}</time>`;
  });
}
