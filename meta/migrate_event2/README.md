# migrate_event2

Once: the events of the PHP CMS (`event2`) into `cms.event`. Register it after `cms.event` and the
event modules; it runs in its `install()`, as long as no `event2` date has a block yet.

- Every `event2` row makes its node an event (a `cms_event` row with address, price, currency,
  language, external link and the performers' names), whatever module shows it: a shop product
  can be a course. What a standard does not take (a malformed link, an unknown language) is left
  out. The default zone of `cms.event` becomes `Europe/Paris`, the zone PHP read and wrote dates in.
- Every `event2_dates` row becomes a `cms_event_date`. All-day dates end on their last day in PHP,
  here after it. Midnight to midnight was a way to enter days without a time: they become dates
  as well. An end before the start is none (a moment). The placeholder PHP made for an event
  without a date ("now", to the second) is left out.
- `cms.cont.event2.default` → `cms.cont.event`, `.category3` → `cms.cont.event.category`,
  `cms.backend.event2` → `cms.backend.event` (the new backend page stands).

The legacy tables stay. What `cms.event` does not hold lives on only there: participants,
capacity, deadline, tags, translation language, performers as users, per-date names and prices.
