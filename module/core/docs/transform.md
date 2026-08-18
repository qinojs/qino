# File transforms

`FileTransformer` turns a source file into a derived one — resize/crop/re-encode an image,
rasterize a PDF page, extract a video frame or audio cover, OCR to Markdown, transcribe media.
It is a **framework-agnostic pipeline**: a list of small transformers run in phase order, each
deciding whether it applies. Results are content-addressed and cached on disk.

```ts
const tf = FileTransformer.create({ cacheDir: "/var/cache/pri/" });
const { path, mime, transformed, key } = await tf.transform("/uploads/photo.heic", { w: 800, fmt: "auto" });
```

The app builds one instance at boot (`app.fileTransformer`); the normal entry point is
`dbFile.transform(options)`, which routes through it and serves the result (see `DbFileManager`).

## Options

`transform(sourcePath, options, knownMime?)` — `options: TransformOptions`:

| Key | Meaning |
|---|---|
| `w` / `h` | target width/height (px); triggers geometry |
| `max` | scale-to-fit instead of scale-to-fill + crop |
| `hpos` / `vpos` | crop focus point in % (default 50 / 20) |
| `zoom` | min scale factor when cropping |
| `q` | quality 1–100 (default 77) |
| `dpr` | device pixel ratio — multiplies `w`/`h` (capped at the call site), then dropped |
| `fmt` | `avif` \| `jpg` \| `png` \| `md` \| `json` \| `auto` (default `auto`) |
| `page` | PDF page (1-based) |
| `frame` | video frame (1-based) |

`fmt: "auto"` encodes candidates and keeps the smallest: AVIF vs JPEG when AVIF is available,
else PNG for images with alpha, else JPEG vs PNG. `fmt: "md"` extracts text (documents → Pandoc, PDF → pdftotext/OCR, images → OCR,
media → transcript). `fmt: "json"` yields a raw transcript.

## Result

```ts
interface TransformResult {
  path: string;        // the derived file, or the source if nothing ran
  mime: string;
  transformed: boolean; // false = original returned (no transformer matched, or an error)
  key?: string;         // content identity (source + options) — stable, usable as ETag
  error?: Error;        // set on failure; path/mime fall back to the source
}
```

Failures never throw out of `transform()` — they return `transformed: false` with `error` set, so
a broken pipeline degrades to serving the original.

## Phases & the pipeline

Transformers declare a `phase`; the pipeline runs phases in a fixed order, and within a phase
sorts by `after` dependencies:

| Phase | Purpose | Built-ins |
|---|---|---|
| `decode` | reduce an exotic input to a plain image/text | `gif-guard`, `pdf-decode`, `svg-decode`, `transcript`, `video-decode`, `audio-decode`, `markdown`, `ocr` |
| `geometry` | resize / crop | `image-resize` |
| `encode` | pick format + quality | `image-encode`, then `pngquant` (`after: image-encode`) |

Each transformer gets a shared `TransformContext` and mutates `currentPath` / `mime` / `meta` as
it hands off to the next. `handles(ctx)` is the guard (mime, options, tool availability); only
matching transformers run. If `currentPath` is unchanged at the end, the source is returned
untouched.

The context is your whole working surface:

| Field | Use |
|---|---|
| `currentPath` | current input; **write your output to a new file and point this at it** |
| `mime` | current MIME; update it when you change the format |
| `sourcePath` | the original source (read-only) |
| `tmpDir` | scratch dir for output files — cleaned up after the run |
| `meta` | notes passed between transformers, e.g. `geometryApplied` lets `encode` know a resize ran |
| `signal` | the shared timeout `AbortSignal` — pass to every external command |
| `options` | the (dpr-resolved) `TransformOptions` |

```ts
interface TransformerDef {
  name: string;
  phase: Phase;
  props: string[];        // option keys this transformer reads → folded into the cache key
  after?: string;         // ordering within the same phase
  handles: (ctx) => boolean | Promise<boolean>;
  transform: (ctx) => Promise<void>;
}
```

Register your own with `tf.register(def)` (names must be unique). `props` matters: only listed
option keys enter the cache key, so declare every option your transformer reads or you'll serve
stale cache hits.

## Caching

The cache key is `SHA-1(sourcePath + size + sorted set-options consumed by any transformer)`. On a
hit, the cached file is returned directly (its mtime is touched for LRU after a day). Writes are
atomic — meta is written first, then the file is `rename`d into place, so concurrent readers never
see a partial result. The key doubles as an ETag: same content + same options ⇒ same key.

There is no content fingerprint yet for **mutable** source paths (only db-files, which are
content-addressed by path). For those, a size change is the only invalidation signal — see the
`> 1.0` note in `FileTransformer.ts`.

## External tools

Heavy lifting shells out to system binaries. Each lives behind a thin wrapper module exposing a
`available()` probe plus its verbs, imported as a namespace:

| Wrapper | Binary | API |
|---|---|---|
| `magick` | `magick`/`convert` (ImageMagick) | `available` · `run` · `identify` · `avifSupported` · `resetCache` |
| `ffmpeg` | `ffmpeg` | `available` · `coverArt` · `frame` · `audio` |
| `pandoc` | `pandoc` | `available` · `run` |
| `pdftotext` | `pdftotext` (Poppler) | `available` · `run` |
| `tesseract` | `tesseract` | `available` · `run` |
| `pngquant` | `pngquant` | `available` · `run` |
| `rsvg` | `rsvg-convert` (librsvg) | `available` · `run` |
| `inkscape` | `inkscape` | `available` · `run` |

```ts
import * as ffmpeg from "./ffmpeg.ts";
if (await ffmpeg.available()) await ffmpeg.frame(input, 0, out, signal);
```

`available()` is a cached probe from `probe(cmd, args)` (`tryCommand.ts`): it runs the binary
once, memoizes the result, and self-registers so `resetProbes()` clears every probe at once —
adding a tool needs no central edit. `imagemagick` keeps its own cache (`resetCache`) because it
also detects IM6-vs-IM7 command names.

Nothing is required: a wrapper whose binary is missing simply reports `available() === false`, its
transformers `handles()` to `false`, and the pipeline skips them (worst case: the original file is
served). Missing tools are a capability gap, not an error.

### Capability introspection

```ts
await FileTransformer.capabilities.avif;   // Promise<boolean> per tool: magick, ffmpeg, avif, pngquant, pandoc, pdftotext, tesseract, rsvg, inkscape
FileTransformer.resetCapabilityCache();    // re-probe after installing a binary at runtime
```

The superuser "transform tools" page reads these to show what's installed.

## OCR & transcript engines

Text/`md` and transcript output delegate to **engines**, so modules can supply better ones than
the built-in Tesseract (e.g. AI vision / speech-to-text). Highest `priority` among the
`available()` ones wins.

```ts
app.fileTransformer.registerOcrEngine({
  name: "ai-vision", priority: 10, beatsTextLayer: true,
  available: (ctx) => hasApiKey(),
  ocr: (imagePath, mime, ctx) => callVisionModel(imagePath),
});
app.fileTransformer.registerTranscriptEngine({ name, priority, available, transcribe });
```

`beatsTextLayer` makes a PDF always OCR (not only scans) — use it when the engine's layout-aware
output is better than the embedded text layer. Core registers `tesseractEngine` (priority 0) as
the floor.

> **Unlink caveat:** engine registration has no unregister — a module that registers an engine
> leaves it after `unlink`. See the module docs' "Not yet torn down" section.

## Timeouts

Every pipeline run shares one `AbortSignal` from `AbortSignal.timeout(transformer.timeout * 1000)`
(default 600 s). Pass it to every external command (`{ signal: ctx.signal }`) so a runaway convert
is killed rather than hanging the request.

## Rules of thumb

- New transformer → declare `phase`, `props` (every option it reads), and an availability-aware
  `handles`. Mutate `ctx.currentPath`/`mime`; leave it untouched to pass through.
- New external tool → a wrapper with `available = probe(...)` + verbs; `run` for the primary
  invocation. No `FileTransformer` edit needed for reset.
- Never assume a tool exists — gate on `available()`; a missing binary must degrade, not throw.
- Reading an option in `transform` but not listing it in `props` = stale cache. Always list it.
