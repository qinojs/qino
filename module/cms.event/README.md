# CMS events

A node *is* an event when `cms_event` has a row with its id (see `cms.node.is` in the cms README):
whatever module shows it — `cms.cont.event`, a shop product that is a course, an appointment
booking. The row holds what the event has: its time zone, venue address, displayed price and
currency, performers, language, an external link, a link to take part online and its `status`
(empty while as planned, `cancelled`, `postponed`, `rescheduled`, as schema.org has them). Its dates
are `cms_event_date` rows; each is one fixed interval with an inclusive `start` and exclusive `end`,
without a recurrence rule, and may have a name and a price of its own (a module of a course).

```ts
import { add, get, set } from "@qino/qino/cms.event";

await set(node, { address_locality: "Zürich", price: 90, currency: "CHF" }); // makes it an event
await add(node, { start: "2027-07-12", end: "2027-07-13" });                 // so does a date
await add(node, { start: "2027-07-14T09:00+02:00", end: "2027-07-14T11:00+02:00" });
```

`icalStatus(status)` gives the status as RFC 5545 has it, `titled(title, date)` the title a named
date goes by ("Course – Module 1"); the calendar source and the iCalendar feed use both.

`get(node)` is the event's row, or undefined. `set(node, values)` checks what it stores — currency
and country codes, the BCP 47 language, the zone, an HTTP(S) link — so whatever shows an event can
trust it; empty is unset. `zoneOf(app, event)` is the zone its dates are entered and shown in: its
own, else the site's (`app.settings["cms.event"].time_zone`, `UTC` until a site sets one).

Date boundaries are signed BIGINT epoch seconds, not strings. The API keeps ISO dates for whole
calendar days and RFC 3339 UTC timestamps for timed dates. Writes with finer than second precision
are rejected rather than rounded. A date may end where it starts: a moment, for an event whose end
is not given (as a VEVENT without DTEND in RFC 5545). `all_day` is derived when writing; whole days
use UTC-midnight storage coordinates and are decoded back to dates, their bounds in a viewer's zone
still follow calendar-day semantics, including DST.

`list(node)` reads the event's dates, `query(node, period)` only the overlapping ones, with their
`dateId`. `add`, `update(node, id, range)` and `remove(node, id)` write them, scoped to the event.
Reads and writes are trusted server APIs: whoever shows or changes an event has checked the node.
Only the calendar source checks for itself: it bounds the dates in SQL before resolving nodes and
their rights; unreadable nodes expose no entries, titles or URLs. Editors of an event get the backend page
of `cms.backend.event` as its `editUrl` (`?id=`), where they may open it; the backend calendar
links that one.

`overview(db, query, order, { from })` joins a trusted paginated selection of event nodes to their
row, at most three date previews, a total count and the period they span, in one query (`from`:
only dates still ahead). Its SQL ordering references the node alias `p`.

Compact storage and ordinary boundary indexes do not guarantee selective interval overlap queries
at billions of rows. Native interval-index support is still a separate design task; see the
workspace's `doc/PLAN-calendar-index.md` for the measured limitation and proposed direction.
