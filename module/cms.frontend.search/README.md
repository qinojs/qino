# cms.frontend.search

Adds its own search item to the `cms.frontend` panel when linked. No configuration or database tables.
K opens the search and focuses its input, using the panel's shortcut handling outside inputs and editors.
The field searches as you type. Arrow keys move between results, Enter opens a result and Escape
closes the search. Enter in the input opens the first result of the current query; while a query
is pending, it runs that search immediately instead.
The query is kept in `sessionStorage` per installation and browser tab, and restored on navigation
or reload. Clearing the field removes it. Results and signed links are not stored.

- Pages and contents: title, text, URL, name, ID and module name. `cont.text` finds contents using
  `cms.cont.text`; words can be combined, for example `cont.text lemon`.
- Hidden and non-searchable nodes are included when the administrator may read them and their
  containing page. Offline nodes follow the CMS's normal readability rules (editors can see them).
  Editable hits open in edit mode; read-only hits use their normal view URL.
  Breadcrumbs show the readable ancestors, including titled content sections.
  Exact IDs, titles and module names rank ahead of general text matches. Plain-text excerpts
  show the matching passage; search words are highlighted without trusting stored HTML.
- Files: filename, extracted text, MIME type and ID, using the existing file access checks.
  Images have thumbnails; PDF and video previews use the installed conversion tools when available.
  Usage links list readable pages containing the file, once per page.
- Users: name, username, organization, contact address and ID, only with reading access to
  `cms.backend.users`. Superusers follow that module's existing visibility rules.

`GET /api/cms.frontend.search/search?pid=…&search=…` requires editing access to `pid` and usage
rights for this module. Results are grouped into `pages`, `contents`, `files` and `users`, with
up to 20 hits each. Node and file searches examine up to 500 candidates before access checks.
The response includes `limit`; groups reaching it are labeled "First 20 results" rather than
presenting the displayed count as a total.
Only the current language is searched in CMS texts and URLs. Administrative searches do not
write to the visitor search statistics.
