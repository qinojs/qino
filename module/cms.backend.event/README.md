# Event management

The backend follows shop management: search and category filters, database pagination,
event creation in a category and a dedicated detail page. Texts, rich-text descriptions,
location, event details and date blocks can be edited directly there. The date/details
editor is the same widget as the frontend settings panel. Cards follow the other backend pages and wrap to their available space.
A translation matrix shows title, location and description in every configured language;
The category remains shared across languages. Publication periods and access grants use
the shared `cms.backend.renderAccess(node, write)` card, also used for products.
Categories are managed in the CMS page structure. Each category is a
`cms.cont.event.category` node, so titles, URLs, hierarchy and permissions remain CMS features.

Every node with dates is listed and edited here, not only `cms.cont.event`: a course sold as a
shop product, a page with a date. Such a node gets title, description and its dates; location,
event details and the category picker belong to events. The dates go through this page's API
(`dates`), as the node's own API knows nothing of them. `backendEdit(node)` gives the editing
panel of every such node an „Event im Backend bearbeiten“ link.

New events start private. The access card can inherit the category or grant public, group and user access explicitly. Moving an event also changes its parent and inherited access.
Backend write access and write access to every affected content node are both required.
Publication times require edit access; changing public or group access requires CMS admin access.
The card follows the frontend panel: inherited group permissions, a public-read checkbox,
a group permission matrix and compact publication controls. It has no user-permission editor.
Read-only backend users only see content they can read and get no editing controls.

Lists show one period from the earliest block start to the latest block end. Undated events
are marked explicitly. Date sorting puts undated events last. Search and filters update the list automatically. Multi-day all-day dates use the last included day in their display.
Lists load fifty candidates per page; permission checks can leave fewer visible entries.
Date bounds and counts join the paginated node selection in one query, without loading all blocks.
The preview query works on SQLite, MySQL/MariaDB and PostgreSQL. Pickers start with one hundred candidates;
selected and currently listed categories are included as well. Further content lists can be managed via CMS editing.
No event/category table or general CMS API is added.

Edits save automatically; each form reports its own save state. Date blocks save once both
ends are valid. Publication and access have their own card; advanced event time-zone settings remain collapsed.
