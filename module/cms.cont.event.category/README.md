# Event category

Like shop categories, an event category is a normal CMS content node. Its direct children
that are events (`cms_event` rows) have individual URLs, titles and permissions. The category lists
the readable children with a date still ahead, the next one first, twenty candidates per page,
with up to three upcoming dates and the locality; past and undated events stay in the backend.
Opening a child renders that event; `?cms_event_ics=<category id>` gives the upcoming dates of all
its events as one iCalendar file to subscribe to. Dates use the event's time zone and the same range formatting
as the detail page. The node selection and its bounded date previews use one SQL query.
No category table or separate category ID is needed: membership is the CMS parent (`basis`).

Add a category to a normal content page, then create events in it through `cms.backend.event`
or the CMS content tree. Moving an event to a category changes its parent and therefore its
inherited permissions. Events outside a category (a course in the shop) still have their dates and feed.
