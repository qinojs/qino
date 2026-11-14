# Event content

One `cms.cont.event` node represents an event, occasion or course. Title, description (`main`)
and location (`location`) use the existing multilingual, inline-editable CMS texts.

The settings panel manages one or more fixed `cms.event` blocks, each with its own start and
exclusive end at whole-second precision. Blocks may use dates for all-day events or local date-times in the configured
IANA `time_zone` (default UTC). An all-day event on July 12 ends on July 13; the public view
displays July 12. Timed blocks are stored as instants and displayed in the configured zone.
Ambiguous or nonexistent new local times are rejected; unchanged instants survive editing.

The existing `cms.event` source supplies these blocks to the central calendar. Node visibility
applies there as well. Only readable nodes with edit access allow block management. IDs are
always scoped to the owning node. This module has no additional database table.

## Event details

The settings panel also manages venue street, postal code, locality and ISO country code,
an optional displayed price and ISO currency, instructor/performer names, a BCP 47 event
language and an external HTTP(S) event or registration URL. These use the node's existing
settings; rendering them adds no database query. Names are public display text, not user IDs.
Prices are informational, not checkout or accounting amounts. Zero is displayed as free admission;
an unset price is omitted. A price requires a currency. The external URL is an explicit link,
so the local event details and calendar destination remain available.

Compared with PHP event2, this keeps the useful descriptive fields. Participant registration,
capacity, waitlists, deadlines, confirmation emails and participant exports need a separate
registration workflow. Tags, recurrence generation and iCalendar export are not included.
