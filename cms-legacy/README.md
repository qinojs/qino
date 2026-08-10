# cms-legacy

Modules that only exist so a site migrated from the PHP CMS keeps working: `page.module` holds the
old module name, and without a module of that name the page renders empty.

They are not part of a normal installation — a new site uses the current modules instead.

| legacy | current |
| --- | --- |
| `cms.layout.custom.6` | `cms.layout.custom.9` |

A module belongs here when the old name has to survive. Where a rename is all that differs,
rewriting `page.module` during the migration is the cheaper answer.
