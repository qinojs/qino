# cms.embed

Indexes CMS pages in the primary `ai1.embed` collection: page texts and titles as source `text`
(part = language) and page files as source `file` (part `text`, and `image` when the model has
`vision`). Files without extracted text use `DbFile.extractText()`. Run `sync(app)` or use the
backend; set `cms.embed.auto` to sync each hour. Unchanged content is not embedded again, and
vectors of texts and files no page uses any more are removed.

`cms.cont.search.embed` searches these sources and checks page readability before rendering a hit.
