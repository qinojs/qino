# cms.embed

Indexes CMS nodes in the primary `ai.embed` collection: each node's title and texts per language as
one Markdown text in `embedding_node_text` (key `node_id`, `lang`). Run `sync(app)` or use the
backend; set `cms.embed.auto` to sync each hour. Unchanged content is not embedded again; vectors no
node uses any more are removed, deleted nodes take theirs along. Files are indexed by `ai.embed`.

The node texts, not rendered pages: a rendered page depends on who looks at it.
`find(ctx, query, { start?, limit? })` gives the pages nearest by meaning, by their texts and the files
on them, each once with its best hit; only those the caller may read and that are searchable. The api
`search` `get` offers it to signed-in users (and agents, as the tool `cmsEmbed_search_get`);
`cms.cont.search.embed` renders it.
