# File transforms

`FileTransformer` derives a file from a source — resize/crop/re-encode an image, render a PDF
page, extract a video frame or audio cover, OCR to Markdown, transcribe media. It is a
**pipeline** of small transformers that run in phase order; each decides whether it applies.
Results are cached on disk.

```ts
const tf = FileTransformer.create({ cacheDir: "/var/cache/pri/" });
const { path, mime, transformed, key } = await tf.transform("/uploads/photo.heic", { w: 800, fmt: "auto" });
```

The app creates one instance at boot (`app.fileTransformer`). Usually you call
`dbFile.transform(options)`, which uses it (see `DbFileManager`).

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

`fmt: "auto"` encodes several formats and keeps the smallest: AVIF vs JPEG if AVIF is available,
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

`transform()` never throws; on failure it returns `transformed: false` with `error`, and the
original is served.

## Phases & the pipeline

Each transformer has a `phase`. Phases run in a fixed order; within a phase, `after` sets the
order:

| Phase | Purpose | Built-ins |
|---|---|---|
| `decode` | reduce an exotic input to a plain image/text | `gif-guard`, `pdf-decode`, `svg-decode`, `transcript`, `video-decode`, `audio-decode`, `markdown`, `ocr` |
| `geometry` | resize / crop | `image-resize` |
| `encode` | pick format + quality | `image-encode`, `svg-optimize`, then `pngquant` (`after: image-encode`) |

All transformers share one `TransformContext` and update `currentPath` / `mime` / `meta` for the
next one. Only transformers whose `handles(ctx)` returns true run (checks mime, options, tools).
If `currentPath` is unchanged at the end, the source is returned.

The context:

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

Register your own with `tf.register(def)` (unique names). Only options listed in `props` are part
of the cache key — list every option you read, or old cache entries are served.

## Caching

The cache key is `SHA-1(sourcePath + size + used options, sorted)`. A hit returns the cached file
(its mtime is refreshed once a day for LRU). Writes are atomic: meta first, then the file is
renamed into place, so readers never see half a file. The key also serves as ETag.

Sources whose content can change at the same path (db-files can't) have no content hash yet; only
a size change invalidates them — see the `> 1.0` note in `FileTransformer.ts`.

## External tools

The real work is done by system binaries. Each has a small wrapper module with an `available()`
check and its commands:

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
| `svgo` | `svgo` | `available` · `run` |
| `scour` | `scour` | `available` · `run` |

```ts
import * as ffmpeg from "./ffmpeg.ts";
if (await ffmpeg.available()) await ffmpeg.frame(input, 0, out, signal);
```

`available()` comes from `probe(cmd, args)` (`tryCommand.ts`): it runs the binary once and caches
the result. `resetProbes()` clears all probes, so a new tool needs no central change. `magick`
has its own cache (`resetCache`) because it also detects IM6 vs IM7.

No tool is required: if a binary is missing, `available()` is false, its transformers don't run,
and at worst the original is served.

### Capability introspection

```ts
await FileTransformer.capabilities.avif;   // Promise<boolean> per tool: magick, ffmpeg, avif, pngquant, pandoc, pdftotext, tesseract, rsvg, inkscape, svgo, scour
FileTransformer.resetCapabilityCache();    // re-probe after installing a binary at runtime
```

The superuser "transform tools" page reads these to show what's installed.

## OCR & transcript engines

OCR and transcripts use **engines**, so modules can add better ones than Tesseract (e.g. AI
vision or speech-to-text). The available engine with the highest `priority` wins.

```ts
app.fileTransformer.registerOcrEngine({
  name: "ai-vision", priority: 10, beatsTextLayer: true,
  available: (ctx) => hasApiKey(),
  ocr: (imagePath, mime, ctx) => callVisionModel(imagePath),
});
app.fileTransformer.registerTranscriptEngine({ name, priority, available, transcribe });
```

With `beatsTextLayer`, PDFs are always OCR'd, not only scans — for engines whose output is better
than the embedded text. Core registers `tesseractEngine` with priority 0.

> Engines cannot be unregistered; they stay after `unlink`. See "Not yet torn down" in
> [module.md](module.md).

## Timeouts

Each run has one `AbortSignal` (`transformer.timeout`, default 600 s). Pass it to every external
command (`{ signal: ctx.signal }`) so a hanging process gets killed.

## Rules of thumb

- New transformer → set `phase`, `props` (every option it reads) and `handles` (incl. tool check).
  Update `ctx.currentPath`/`mime`, or leave them to pass through.
- New tool → a wrapper with `available = probe(...)` and `run` for the main call.
- Never assume a tool exists — check `available()`; a missing binary must not throw.
- An option read but not listed in `props` = stale cache.
