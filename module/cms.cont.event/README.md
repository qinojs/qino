# Event content

One `cms.cont.event` node represents an event, occasion or course. Title, description (`main`)
and location (`location`) use the existing multilingual, inline-editable CMS texts.

The settings panel manages one or more fixed `cms.event` blocks, each with its own start and
exclusive end at whole-second precision. Blocks may use dates for all-day events or local date-times in the configured
IANA `time_zone` (initially taken from the editor’s browser, UTC before the first save). The editor uses the last included day for all-day ends. An all-day event entered as July 12–12
is stored with exclusive end July 13; public views display July 12. Timed blocks are stored as instants and displayed in the configured zone.
Ambiguous or nonexistent new local times are rejected; unchanged instants survive editing.

The existing `cms.event` source supplies these blocks to the central calendar. Node visibility
applies there as well. Block management requires edit access, including for unpublished drafts. IDs are
always scoped to the owning node. This module has no additional database table.

`formatDates(blocks, lang, timeZone)` supplies the shared range display for event details and
overviews.

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
