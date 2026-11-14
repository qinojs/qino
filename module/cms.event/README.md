# CMS events

`cms.event` attaches calendar events to CMS nodes. `cms_event.node_id` refers to the node;
several events may share a node, title and destination. Source integration lives in `calendar.ts`.

```ts
import { add } from "@qino/qino/cms.event";

await add(node, { start: "2027-07-12", end: "2027-07-13" });
await add(node, { start: "2027-07-12T09:00+02:00", end: "2027-07-12T11:00+02:00" });
await add(node, {
  start: "2027-07-12T09:00+02:00", end: "2027-07-12T11:00+02:00",
  timeZone: "Europe/Zurich", rrule: "FREQ=WEEKLY;BYDAY=MO",
  exdate: ["2027-07-19T09:00+02:00"],
});
```

Boundaries follow `calendar`: inclusive start, exclusive end. ISO date-only values represent
all-day events; timed values are normalized to RFC 3339 UTC timestamps. There is no implicit local
time zone and no separate all-day flag. A caller writing through this trusted server API must
authorize the change; calendar reads enforce each node's `isReadable()` permission.

`calendar.entries(ctx, period)` includes these events while `cms.event` is linked. The query is
bounded in the database before resolving permissions and titles. Multiple events on the same
node share those lookups within the query. Reads never create events or missing dates.

`list(node)` reads definitions and `query(node, period)` expands their occurrences. Both enforce
node visibility. Trusted writes use `add`, `update(node, id, schedule)`, and `remove(node, id)`;
updates/deletions cannot address another node's events. `cms.cont.booking` provides an editor
for the offers it owns. Recurring definitions store standard RRULE, IANA `time_zone`, and JSON
RDATE/EXDATE arrays; their concrete occurrences are generated only on demand. The calendar source
checks node readability before expanding a definition or exposing its title or URL.
