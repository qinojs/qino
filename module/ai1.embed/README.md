# ai1.embed

Local vector search over rows in any database table. Embeddings and row links are stored in the
application database; `sqlite-vec` builds a disposable search index in the module cache. No server
or additional database process is needed. Each app has its own index. Deno needs `--allow-ffi`
to load the local SQLite extension.

```ts
import { indexImage, indexText, search, sync, upsert } from "@qino/qino/ai1.embed";

await indexText(app, "docs", { table: "article", id: 42, part: "body" }, "A short article");
await upsert(app, "images", { table: "file", id: 7, part: "image" }, imageVector, "Photo of a cat", "image-model");
await indexImage(app, "images", { table: "file", id: 8, part: "image" }, imageDataUrl, "image-model");
const hits = await search(app, "docs", "article to find", { table: "article", limit: 10 });
await sync(app); // reconcile all text_lang and file rows in the main collection
```

The first write creates a collection and pins one model. Pass `model` when creating a collection
from externally produced vectors, such as image embeddings. Search with a vector from that same
model. A text query uses the collection's pinned `ai1.embed` model.

`upsert`, `remove`, and `search` work with any table and row id. `part` distinguishes fields or
chunks of one row. `indexText` generates an embedding through ai1 and stores the source text;
`upsert` takes an already computed vector, including one produced from an image. `indexImage`
uses an ai1 adapter whose `embed` capability accepts images. The built-in OpenAI-compatible
adapter embeds text only; multimodal embedding models can be supplied by another adapter.
The source table
still owns access control: consumers must check whether a returned row is readable.

`sync` indexes all rows of the generic `text_lang` and `file` tables, extracting file text through
`DbFile.extractText()` when needed. `ai1.embed.auto` can keep those rows current after table writes:
listeners schedule work after commit, so the database write does not wait for embedding. Writes made
with raw SQL bypass table events; run `sync` to reconcile them. The backend manages the collection,
automatic indexing, chunk size, and manual reconciliation without assuming any CMS page structure.

The index is rebuilt from the application database after a stale or deleted cache. sqlite-vec
executes cosine search locally. It is an exact scan inside one collection; for very large indices,
search time grows with the collection size.
