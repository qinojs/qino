# Event management

The backend follows shop management: search and category filters, database pagination,
event creation in a category and links to the CMS editor for texts, details and date blocks.
The categories tab inserts categories in existing content lists (the shared `default module`
setting identifies lists, as used by flexible content and items). Each category is a
`cms.cont.event.category` node, so titles, URLs, hierarchy and permissions remain CMS features.

New events start private. Sharing restores inherited category access; it never grants public
access beyond that category. Moving an event also changes its parent and inherited access.
Backend write access and write access to every affected content node are both required.
Changing visibility requires CMS admin access to that event, just like the regular CMS access API.
Read-only backend users only see content they can read and get no editing controls.

Lists load fifty candidates per page; permission checks can leave fewer visible entries.
Block counts are grouped in SQL for that page. Pickers start with one hundred candidates;
selected and currently listed categories are included as well. The paginated categories tab
links to each category's events. Further content lists can be managed via CMS editing.
No event/category table or general CMS API is added.
