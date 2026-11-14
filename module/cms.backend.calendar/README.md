# Backend calendar

Install `cms.backend.calendar` for a backend calendar page. It reads `calendar.entries()` and has
no dependency on a particular source. Link `cms.event` to include node events, or provide another
module's `calendar.query(ctx, period)` export.

The browser requests the visible period in its IANA time zone, refreshes on navigation and links
entries to their source page. Empty results and failed requests are shown separately. The page
does not create sample events or change source data.

A compact Sources button opens the U2 form dialog. Source visibility is stored in the current
user's existing context settings (the session's for guests), as booleans by source ID. New sources
are visible by default. This is a display preference and never grants access to source data.
Declared `pub/module.svg#main` icons appear beside entries and in the source chooser, through
Qino's existing `moduleIcon()` helper; undeclared icons require no filesystem probes.

The calendar requires the updated `u2-calendar` range-change event and exclusive end semantics.
The demo maps the calendar element to the neighbouring U2 checkout during development.

`backendDashboardWidget` shows up to ten current/upcoming entries in the next seven days.
It requests the period in the browser's time zone through the same node API, using only the
user's saved active sources. Source permissions still apply. Data is loaded after rendering
the dashboard rather than adding blocking calendar queries to its page request.
