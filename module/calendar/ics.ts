import { instant, isDate, validateRange } from "./mod.ts";

import type { Entry } from "./mod.ts";

const text = (value: string) => value.replace(/[\;,]/g, "\\$&").replace(/\r?\n/g, "\\n");
const stamp = (time: Temporal.Instant) => time.toString({ smallestUnit: "second" }).replace(/[-:]/g, "");
const UTF8 = new TextEncoder();

/** Content lines are at most 75 octets; longer ones continue after a line break and a space, never inside a character. */
function fold(line: string) {
  let out = "", size = 0;
  for (const char of line) {
    const octets = UTF8.encode(char).length;
    if (size + octets > 75) { out += "\r\n "; size = 1; }
    out += char;
    size += octets;
  }
  return out;
}

/** Entries as an iCalendar object (RFC 5545): whole days as dates, the rest in UTC, a moment without an end. */
export function ics(entries: (Entry & { location?: string; description?: string })[], { host }: { host: string }): string {
  const now = stamp(Temporal.Now.instant());
  const events = entries.flatMap((entry) => {
    validateRange(entry);
    const days = isDate(entry.start);
    const time = (name: string, value: string) => days ? `${name};VALUE=DATE:${value.replaceAll("-", "")}` : `${name}:${stamp(instant(value))}`;
    return [
      "BEGIN:VEVENT", `UID:${entry.id}@${host}`, `DTSTAMP:${now}`, time("DTSTART", entry.start),
      ...(entry.start === entry.end ? [] : [time("DTEND", entry.end)]),
      `SUMMARY:${text(entry.title)}`,
      ...(entry.description ? [`DESCRIPTION:${text(entry.description)}`] : []),
      ...(entry.location ? [`LOCATION:${text(entry.location)}`] : []),
      ...(entry.url ? [`URL:${entry.url}`] : []),
      "END:VEVENT",
    ];
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${host}//qino//EN`, ...events, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
