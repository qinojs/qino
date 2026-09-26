# cms.embed

Indexes CMS page titles, page texts, and attached file text in an `ai1.embed` collection. Files
without extracted text use the existing `DbFile.extractText()` pipeline, which can convert documents,
PDFs, and audio to Markdown or plain text when its tools are available. The default collection is
`cms`; pass another name to `sync(app, name)` or select it in `cms.backend.ai1.embed`.

Indexing runs on demand from the backend. Set `cms.embed.auto` to reindex each hour. Unchanged text
is not embedded again. Removed page text and file links lose their text vectors on the next sync;
an independently stored image vector (`part: "image"`) is preserved.

`cms.cont.search.embed` searches the collection and checks each page's readability before rendering
a hit. Applications using `ai1.embed` directly must enforce access to their source rows themselves.
