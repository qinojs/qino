# ai1.embed

Vector search over rows of any table, stored in the application database with its native vector
type: sqlite-vec (Deno needs `--allow-ffi`), MariaDB ≥ 11.7 or PostgreSQL with pgvector. MariaDB
and PostgreSQL search through an HNSW index, SQLite scans exactly.

A collection is one embedding model with its vector length; its vectors live in the table
`ai1_embed_<id>`. New installations start with `jina-embeddings-v5-omni-small/1024`; the model and
its provider are configured in `ai1`. Calls without `collection` use the primary one.

```ts
import { create, index, remove, search } from "@qino/qino/ai1.embed";

await create(app, "jina-embeddings-v5-omni-small", 1024);
await index(app, { source: "article", id: 42, part: "body" }, articleText);
await index(app, { source: "file", id: 7, part: "image" }, { image: dataUrl, hash: file.md5 });
const hits = await search(app, "what to find", { where: sql`e.source = ${"article"}`, limit: 10 });
await remove(app, { source: "article", id: 42 });
```

A vector belongs to `source` + `id` (usually a table and its row), optionally to a `part` (a field,
a language, an image). `index` splits text into chunks, skips unchanged ones and reuses the vector
of equal content (same text, same image `hash`). `search` filters with `where` on the collection
table (alias `e`) before the limit applies; subqueries into the source tables work there too.
Check access to the source rows before showing hits.

`cms.embed` indexes CMS pages this way.
