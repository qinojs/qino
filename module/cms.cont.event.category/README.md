# Event category

Like shop categories, an event category is a normal CMS content node. Its direct
`cms.cont.event` children have individual URLs, titles and permissions. The category lists
readable children in CMS order, twenty candidates per page; opening a child renders that event.
No category table or separate category ID is needed: membership is the CMS parent (`basis`).

Add a category to a normal content page, then create events in it through `cms.backend.event`
or the CMS content tree. Moving an event to a category changes its parent and therefore its
inherited permissions. Independently placed event blocks still work without a category.
