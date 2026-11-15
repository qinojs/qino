import { instant, isDate, validateRange } from "./mod.ts";

import type { Entry } from "./mod.ts";

const text = (value: string) => value.replace(/[\\;,]/g, "\\$&").replace(/\r?\n/g, "\\n");
const stamp = (time: Temporal.Instant) => time.toString({ smallestUnit: "second" }).replace(/[-:]/g, "");

/** Content lines are at most 75 octets; longer ones continue after a line break and a space, never inside a character. */
function fold(line: string) {
  let out = "", size = 0;
  for (const char of line) {
    const code = char.codePointAt(0)!, octets = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; // its UTF-8 length
    if (size + octets > 75) { out += "\r\n "; size = 1; }
    out += char;
    size += octets;
  }
  return out;
}

/** Entries as an iCalendar object (RFC 5545): whole days as dates, the rest in UTC, a moment without an end.
 *  `organizer` names who holds them; RFC 5545 needs an address for it, so without one there is none. */
export function ics(entries: (Entry & { location?: string; description?: string })[], { host, organizer }: {
  host: string; organizer?: { name?: string; email?: string };
}): string {
  const now = stamp(Temporal.Now.instant());
  // a parameter value is quoted, and may then hold anything but the quote itself
  const by = organizer?.email ? `ORGANIZER${organizer.name ? `;CN="${organizer.name.replaceAll('"', "")}"` : ""}:mailto:${organizer.email}` : "";
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
      ...(entry.status ? [`STATUS:${entry.status}`] : []),
      ...(by ? [by] : []),
      "END:VEVENT",
    ];
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${host}//qino//EN`, ...events, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
