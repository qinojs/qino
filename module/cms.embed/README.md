# cms.embed

Indexes CMS nodes in the primary `ai1.embed` collection: each node's title and texts per language as
one Markdown text in `embedding_node_text` (key `node_id`, `lang`), the files attached to nodes in
`embedding_file_text` and, when the model has `vision`, `embedding_file_image`. Files without
extracted text use `DbFile.extractText()`. Run `sync(app)` or use the backend; set `cms.embed.auto`
to sync each hour. Unchanged content is not embedded again; vectors no node uses any more are
removed, deleted nodes and files take theirs along.

The node texts, not rendered pages: a rendered page depends on who looks at it.
`cms.cont.search.embed` searches these tables and checks access before rendering a hit.
