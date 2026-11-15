# Calendar

Shared calendar time logic, usable independently of the CMS and without database access.

```ts
import { overlaps } from "@qino/qino/calendar";

overlaps(
  { start: "2027-07-10T15:00+02:00", end: "2027-07-13T09:00+02:00" },
  { start: "2027-07-12", end: "2027-07-13" },
  { timeZone: "Europe/Zurich" },
); // true
```

`Range` has an inclusive `start` and exclusive `end`. Adjacent bookings do not overlap.
Both boundaries must be dates (`YYYY-MM-DD`) or both timestamps, and the end must follow the start —
except a timestamp may end where it starts: a moment, for an entry whose end is not given (a VEVENT
without DTEND, RFC 5545). It overlaps a period that contains its start.
An all-day entry for July 12 ends on July 13. Dates are compared as calendar dates.

Timed entries use ISO timestamps with UTC/offsets, or Temporal strings with an IANA time zone
annotation. Local timestamps without an offset or time zone are rejected. Named time zones are
validated, including consistency with any supplied offset.

Comparing all-day and timed entries requires `timeZone`: dates become the start of their local
calendar day, including days whose first valid time is later than midnight. No machine time zone
is assumed, and days are not treated as fixed 24-hour durations. An entirely skipped local date
has no overlap with timed entries.

The building blocks are exported as well, so sources and editors need no parsing of their own:
`isDate(value)` tells dates from timestamps, `instant(value, timeZone?)` and
`instants(range, timeZone?)` give exact bounds, `validateRange(range)` throws on a malformed or
empty range. For editors working in wall time, `exact(value, timeZone)` reads a local date-time
in a zone (skipped and repeated times throw; dates and exact timestamps pass through) and
`toLocal(value, timeZone)` is its reverse.

## Sources

`entries(ctx, { start, end, timeZone })` reads every linked module exporting
`calendar.query(ctx, period)`. It normalizes the query to exact ISO instants and supplies the
viewer's IANA time zone. Sources filter their storage by this period and enforce their own access
rules before returning `{ id, title, start, end, url?, editUrl? }` entries.

`sources(app, lang)` lists available source IDs and titles. A source may supply `title` as a string
or language map, and an optional `color` string. Color interpretation belongs to the consumer:
the backend uses named theme tokens (`green` → `var(--green, green)`) or CSS color values
such as `#3878c8`, `oklch(...)` or `var(--brand)`. Without a color, the inherited theme applies.
`entries(ctx, { ...period, sources: [...] })` queries only selected sources; an
empty list selects none, and an omitted list selects all. `dateRange(period)` supplies the calendar
dates touched by a normalized exact period for sources that store date-only information.

The result adds the source module's name as `source` and keeps only overlapping entries. IDs are
unique within a source. Source failures propagate so an unavailable source is not shown as an
empty calendar. This abstraction has no dependency on the CMS, backend or a particular source.

## iCalendar

`ics(entries, { host })` writes entries as an iCalendar object (RFC 5545) for a download, a feed or
a mail attachment. Whole days become `VALUE=DATE` with the exclusive end the standard asks for, timed
entries UTC timestamps, a moment a `DTSTART` alone. Entries may carry a `description` and a
`location`; `host` makes their `id` a globally unique `UID`.

## Recurrence

`occurrences(schedule, period)` expands fixed or repeating nonempty intervals. `schedule` contains
`start`, `end`, and optional `rrule`, `timeZone`, `rdate`, `exdate`. RRULE follows RFC 5545;
additional and excluded starts use the same ISO date type as `start`. Timed recurrence requires
an IANA time zone, either explicitly or in the initial ZonedDateTime annotation.

```ts
occurrences({
  start: "2027-03-22T09:00+01:00", end: "2027-03-22T11:00+01:00",
  timeZone: "Europe/Zurich", rrule: "FREQ=WEEKLY;BYDAY=MO",
}, { start: "2027-03-01", end: "2027-05-01", timeZone: "Europe/Zurich" });
```

The implementation uses `rrule-temporal` with the application's Temporal implementation and
bounded generation work. Only overlapping occurrences are returned, including those starting
before the query. Local starts retain their wall time across DST. A timed `end` preserves the
initial exact duration (RFC 5545 DTEND); all-day durations remain calendar days. Missing month
days and nonexistent generated local times follow RRULE semantics, not subscription billing rules.
Every result has a `recurrenceId` identifying its original start. Moving an occurrence while
retaining that identity is not yet implemented.
