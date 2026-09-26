# ai1.embed

Local vector search over rows in any database table. Embeddings and row links live in the
application database (SQLite or MySQL). `sqlite-vec` builds a disposable search index in the
module cache. No server or additional database process is needed. Deno needs `--allow-ffi` to
load the local SQLite extension.

Create a collection by choosing an embedding model and its vector dimensions. Its name is
`model/dimensions`, for example `jina-embeddings-v2-base-en/768`. The first collection becomes
the primary collection automatically. The backend displays all collections and can choose another
primary collection. Dimensions describe the length of each vector, not the number of stored entries.
The embedding adapter must return vectors of that length.
New installations start with `jina-embeddings-v5-omni-small/1024`. Configure the model and its
provider in `ai1` before embedding content; the collection alone does not make API calls available.

```ts
import { create, indexImage, indexText, search, sync, upsert } from "@qino/qino/ai1.embed";

await create(app, "text-model", 768);
await indexText(app, { table: "article", id: 42, part: "body" }, "A short article");
const hits = await search(app, "article to find", { table: "article", limit: 10 });
await sync(app); // reconcile text_lang and file rows in the primary collection

await create(app, "image-model", 512);
const image = { model: "image-model", dimensions: 512 };
await upsert(app, { table: "file", id: 7, part: "image" }, imageVector, { ...image, content: "Photo of a cat" });
await indexImage(app, { table: "file", id: 8, part: "image" }, imageDataUrl, image);
```

Calls without `model` and `dimensions` use the primary collection. Pass both to use another
collection. `upsert`, `remove`, and `search` work with any table and row id. `part` distinguishes
fields or chunks of one row. `indexText` embeds text through ai1. `upsert` accepts an existing
vector, including one produced from an image. `indexImage` uses an ai1 adapter that accepts images.
Consumers must enforce access to source rows before showing search results.

`sync` indexes the generic `text_lang` and `file` tables, extracting file text through
`DbFile.extractText()` when needed. `ai1.embed.auto` maintains them after table writes. Raw SQL
bypasses table events; run `sync` to reconcile it. Image files also get an `image:<hash>` part
when the selected model has `vision`; unchanged files are not embedded again. The Jina provider
uses its multimodal v5 Omni API for this. Existing Jina providers need type `jina` in `ai1`.

The local search index is rebuilt from the application database when stale or missing. sqlite-vec
runs exact cosine search within one collection, so search time grows with collection size.
