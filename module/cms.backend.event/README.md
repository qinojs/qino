# Event management

The backend follows shop management: search and category filters, database pagination,
event creation in a category and a dedicated detail page. Texts, rich-text descriptions,
location, event details and date blocks can be edited directly there. The date/details
editor is the same widget as the frontend settings panel. Text editing supports the site's languages.
Categories are managed in the CMS page structure. Each category is a
`cms.cont.event.category` node, so titles, URLs, hierarchy and permissions remain CMS features.

New events start private. Sharing restores inherited category access; it never grants public
access beyond that category. Moving an event also changes its parent and inherited access.
Backend write access and write access to every affected content node are both required.
Changing visibility requires CMS admin access to that event, just like the regular CMS access API.
Read-only backend users only see content they can read and get no editing controls.

Lists show one period from the earliest block start to the latest block end. Undated events
are marked explicitly. Date sorting puts undated events last. Search and filters update the list automatically. Multi-day all-day dates use the last included day in their display.
Lists load fifty candidates per page; permission checks can leave fewer visible entries.
Date bounds and counts join the paginated node selection in one query, without loading all blocks.
The preview query works on SQLite, MySQL/MariaDB and PostgreSQL. Pickers start with one hundred candidates;
selected and currently listed categories are included as well. Further content lists can be managed via CMS editing.
No event/category table or general CMS API is added.

Edits save automatically; each form reports its own save state. Date blocks save once both
ends are valid. Visibility actions are directly accessible; advanced time-zone settings remain collapsed.
