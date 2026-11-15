# Event content

One `cms.cont.event` node represents an event, occasion or course. Title, description (`main`)
and location (`location`) use the existing multilingual, inline-editable CMS texts.

The settings panel manages one or more fixed `cms.event` blocks, each with its own start and
exclusive end at whole-second precision. Blocks use dates for all-day events or local date-times
in the node's IANA `time_zone`, else the default of `cms.event` (`zoneOf(node)`).
The editor shows the last included day for all-day ends: July 12–12 is stored with the exclusive
end July 13. A row saves when both ends are valid; the empty last row adds a block. Ambiguous or
nonexistent new local times are rejected; unchanged instants survive editing.

The existing `cms.event` source supplies these blocks to the central calendar. Node visibility
applies there as well. Block management requires edit access, including for unpublished drafts. IDs are
always scoped to the owning node. This module has no additional database table.

`formatDates(blocks, lang, timeZone)` supplies the shared range display for event details and
overviews.

Standard outputs, without a setting: the detail page links its dates as an iCalendar download
(`?cms_event_ics=<node id>`, RFC 5545) and, where the event is what the page is about, adds one
schema.org `Event` per date (place, address, offer, performers, language) for search engines.
`entries(node, ctx)` gives the blocks as calendar entries with title, place and description;
`answer(ctx, node, events)` sends the iCalendar file for a node — the category uses both for its feed.

## Event details

The settings panel also manages venue street, postal code, locality and country code, an
optional displayed price and ISO 4217 currency, instructor/performer names, a BCP 47 event
language and an external HTTP(S) event or registration URL. These are plain node settings, saved
as typed; rendering them adds no database query. Names are public display text, not user IDs.
Prices are informational, not checkout or accounting amounts. Zero is displayed as free admission.
Whatever cannot be shown is left out rather than rejected: a price without a valid currency, an
unknown language tag, a link that is not HTTP(S).

Compared with PHP event2, this keeps the useful descriptive fields. Participant registration,
capacity, waitlists, deadlines, confirmation emails and participant exports need a separate
registration workflow. Tags and recurrence generation are not included.
