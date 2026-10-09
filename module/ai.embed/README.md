# ai.embed

Vector search over rows of any table, in the application database with its native vector type:
sqlite-vec (Deno needs `--allow-ffi`), MariaDB ≥ 11.7 or PostgreSQL with pgvector. MariaDB and
PostgreSQL search through an HNSW index, SQLite scans exactly.

Whatever is embedded gets its own table `embedding_<name>`, declared by the module that embeds it,
usually named `<table>_<aspect>`: `product_text`, `product_image`, `node_text`, `user_bio`. The key is up
to the module (primary key columns besides `chunk` and `collection_id`); a key column with
`x-qg-parent` deletes the vectors along with its row. Only the column `embedding` is special:

```json
"embedding_product_image": { "additionalProperties": {
  "properties": {
    "product_id":    { "type": "integer", "x-index": "primary", "x-qg-parent": "product", "x-qg-on-parent-delete": "cascade" },
    "chunk":         { "type": "integer", "x-index": "primary", "default": 0 },
    "collection_id": { "type": "integer", "x-index": "primary", "x-qg-parent": "ai_embed_collection", "x-qg-on-parent-delete": "cascade" },
    "hash":          { "type": "string", "maxLength": 64, "x-index": true },
    "content":       { "type": "string" },
    "embedding":     { "type": "array", "items": { "type": "number" }, "x-vector": true, "x-index": true }
  },
  "required": ["product_id", "chunk", "collection_id", "hash", "embedding"]
}}
```

`chunk` numbers the pieces of a long text (cut between paragraphs where possible), `hash` identifies the embedded content (unchanged content is
not embedded again, equal content reuses a vector), `content` is the text shown with a hit. MariaDB
allows 256 bytes of primary key for a vector index: hash long string keys such as paths.

A collection is one embedding model with its vector length. Collections share the tables, so a new
model can be indexed while the old one still answers. New installations start with
`jina-embeddings-v5-omni-small/1024`; the model and its provider are configured in `ai`. Calls
without `collection` use the primary one.

```ts
import { sql } from "@qino/qino";
import { index, remove, search } from "@qino/qino/ai.embed";

await index(app, "product_text", { product_id: 7 }, text);
await index(app, "product_image", { product_id: 7 }, { image: dataUrl, hash: md5 });
const hits = await search(app, { product_text: true, node_text: sql`e.lang = ${lang}` }, "what to find");
await remove(app, "product_text", { product_id: 7 });
```

`search` takes one name, or several with a filter each on the table's rows (alias `e`; `true` for
none) that applies before the limit. A query text is embedded once and kept (the last 1000 per app);
a vector is taken as it is. Hits carry `name`, `key`, `chunk`, `content` and `score`. Check access
before showing them.

`embedded(app, name, key)` gives the vectors stored under a key, one per chunk: to search near a text
already kept (an agent's role) without embedding it again. A query is embedded apart from what is
stored (`purpose`), so a stored vector stands for the text, not for a question about it.

Vectors are stored at length 1, so every dialect's default distance ranks like cosine. PostgreSQL
keeps each row at its own length and indexes each collection separately (up to 2000 dimensions).
MariaDB needs one length per column: it grows to the longest collection, shorter vectors are padded
with zeros, which changes no distance.

Files of the core table `file` are built in (`sources/file.ts`): `file_text` and, when the model has
`vision`, `file_image`. With the setting `files` each new or replaced file is indexed in the
background and the others each hour; `indexFiles(app)` catches up by hand, `indexFile(app, id)` indexes one.

`cms.embed` indexes CMS pages.
