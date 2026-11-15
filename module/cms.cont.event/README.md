# Event content

A `cms.cont.event` node shows an event, occasion or course; the module makes its nodes events
(`is: ["cms_event"]`, see `cms.event`). Title, description (`main`) and location (`location`) are
the multilingual, inline-editable CMS texts; address, price, performers, language and link are the
event's row, its dates `cms.event` dates.

The settings panel edits the event: its dates and details. Dates are whole days or local
date-times in the event's zone (its own, else the site's). The editor shows the last included day
for all-day ends: July 12–12 is stored with the exclusive end July 13. A row saves when both ends
are valid, an empty end is a moment; the empty last row adds a date. Details save as they are
left; the server checks them (codes, language, link, zone), so the page shows them as they are.
Ambiguous or nonexistent new local times are rejected; unchanged instants survive editing.

`edit(node, input)` is the editing API, also for events shown by other modules: `get` the event,
its zone and its dates in local time; `set` details; `save` and `remove` a date. The backend calls
it for any event. Editing requires edit access, including for unpublished drafts.

`formatDates(dates, lang, timeZone)` supplies the shared range display for event details and
overviews. Prices are informational, not checkout or accounting amounts; zero is free admission.
Names are public display text, not user IDs.

Standard outputs, without a setting: the detail page links its dates as an iCalendar download
(`?cms_event_ics=<node id>`, RFC 5545) and, where the event is what the page is about, adds one
schema.org `Event` per date (status, place and online location, offer, performers, language,
organizer) for search engines. A named date goes by "Title – Name", with its own price if it has
one. The organizer is the site's (`identity`: organization or name, contact email).
`answer(ctx, node, events)` sends the iCalendar file for a node — the category uses it for its feed.

Compared with PHP event2, this keeps the useful descriptive fields. Participant registration,
capacity, waitlists, deadlines, confirmation emails and participant exports need a separate
registration workflow. Tags and recurrence generation are not included.
