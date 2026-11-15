# CMS event blocks

A node can have multiple `cms_event` records. Each record is one concrete block with an inclusive
`start` and exclusive `end`; it has no recurrence rule. Title, destination and visibility belong
to its CMS node. Separate dates or course sessions are separate blocks on the same node.

```ts
import { add } from "@qino/qino/cms.event";

await add(node, { start: "2027-07-12", end: "2027-07-13" });
await add(node, { start: "2027-07-14T09:00+02:00", end: "2027-07-14T11:00+02:00" });
```

Database boundaries are signed BIGINT epoch seconds, not strings. The API keeps ISO dates
for whole calendar days and RFC 3339 UTC timestamps for timed entries. Writes with finer than
second precision are rejected rather than rounded. IDs use BIGINT as well.

`all_day` is derived and stored when writing, so SQL does not inspect boundary formats. Whole
calendar days use UTC-midnight numeric storage coordinates and are decoded back to dates;
their actual bounds in a viewer's time zone still follow calendar-day semantics, including DST.

`list(node)` reads the node's blocks, `query(node, period)` only the overlapping ones, with their
`eventId`. A block may end where it starts: a moment, for an event whose end is not given (as a
VEVENT without DTEND in RFC 5545). Reads and writes (`add`, `update(node, id, range)`,
`remove(node, id)`) are trusted server APIs: whoever shows or changes blocks has checked the node.
Updates and deletions are scoped to the owning node. Only the calendar source checks for itself.

`overview(db, query, order)` joins a trusted paginated node selection to at most three block
previews per node, a total block count and an encompassing period, in one query. Its SQL ordering
references the node alias `p`. Callers enforce node permissions before displaying these results.

The calendar source applies the time bounds in SQL before resolving nodes and their rights.
Unreadable nodes expose no entries, titles or URLs. Repeated node lookups are shared within the
query; reads never create blocks or missing dates. A later higher-level generator may create
concrete nodes and their blocks from recurrence rules; no such generator is implemented here.

Compact storage and ordinary boundary indexes do not guarantee selective interval overlap queries
at billions of rows. Native interval-index support is still a separate design task; see the
workspace's `doc/PLAN-calendar-index.md` for the measured limitation and proposed direction.
