# ai1.web

The web for agents and the browser, as an api. Apart from the models of [ai1](../ai1/): search engines
and readers are no models, each is used with its key in `core.keys`.

```
search   get  { query, count? }                    the pages found: [{ title, url, snippet }]
read     get  { url, maxAge?, offset?, length? }   a page as Markdown, a part at a time (20,000 characters):
                                                   { id, url, title, content, offset, size, reader, time }
crawl    post { url, max?, wait? }                 read the pages below url, following their links;
                                                   with wait: { read, failed, left }
pages    get  { search?, root? }                   search the pages read, only those below root
```

```ts
import { pages, read, search } from "@qino/qino/ai1.web";

const [first] = await search(app, "qino cms", { count: 5 });
const { content } = await read(app, first.url);
```

- **Engines:** [Brave Search](https://brave.com/search/api/) (`api.search.brave.com`, its own index)
  and [Serper](https://serper.dev) (`google.serper.dev`, Google's results). The first engine with a
  key answers; if it fails, the next.
- **Readers:** [Jina Reader](https://jina.ai/reader) (`api.jina.ai`) and
  [Firecrawl](https://firecrawl.dev) (`api.firecrawl.dev`) where there is a key, else our own
  fetch. A service renders scripts and reads PDFs, and fetches from its network; our own fetch costs
  nothing, never reaches our own network (`safeFetch`) and turns HTML, PDF and documents into
  Markdown with the transform pipeline (Pandoc, pdftotext), without running scripts.
- **Crawl:** from `url`, following the links that start with it (no images, media, CSS, JS), at
  most `max` (default 100), one page after the other, through `read` and its cache. `left` tells
  how many links found were not read yet. No `robots.txt`.
- **Searching the pages read:** `read` with `length: 0` only keeps a page, so an agent can read many
  and then search them with `pages`.
- **Cache:** every page read is kept (`ai1_web_page`) and read again after a day (`maxAge`). Where
  there is an embedding collection ([ai1.embed](../ai1.embed/)), it is findable by meaning
  (`pages`), else by its words.
- **Agents** get it as tools with the path `ai1.web` in their `tools`.
- **Signed-in users** only: searching and reading cost.
