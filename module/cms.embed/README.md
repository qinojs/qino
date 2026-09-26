# cms.embed

Indexes CMS page titles, page texts, and attached file text in the primary `ai1.embed` collection.
Files without extracted text use `DbFile.extractText()`, which can convert supported documents,
PDFs, and audio to Markdown or plain text when its tools are available. Create a collection first,
then run `sync(app)` or use the backend. Set `cms.embed.auto` to reindex each hour.

Unchanged text is not embedded again. Removed page text and file links lose their text vectors on
the next sync; independently stored image vectors (`part: "image"`) are preserved.
`cms.cont.search.embed` searches the primary collection and checks page readability before
rendering a hit. Applications using `ai1.embed` directly must enforce access to source rows.
