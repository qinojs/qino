# Resource hotspots

Where a running Qino server spends RAM, disk and CPU. Server-side only — nothing here is about
what a browser does with the delivered page.

Each entry names the code, what it costs, what bounds it, and what makes it grow.

## RAM

| Where | Bound by |
|---|---|
| [CMS.ts:29](../module/cms/lib/CMS.ts#L29) — node identity map | nothing: every node ever touched, per app, for the process lifetime |
| [LangManager.ts:14](../module/core/lib/LangManager.ts#L14) — `smalltext` index | full table per `lang × namespace`, never evicted |
| [ReqBody.ts:51](../module/core/lib/ctx/ReqBody.ts#L51) — body parsing | `core.uploadMaxFileSize`, default 100 MB, **per concurrent request** |
| [sanitize.ts:101](../module/cms/lib/sanitize.ts#L101) — sanitized-HTML cache | 500 entries per policy, but entry size is the text size |
| [limit.ts](../module/core/lib/transform/limit.ts) — external process cap | `navigator.hardwareConcurrency` decoders at their peak |
| [DbFileManager.ts:34](../module/core/lib/DbFileManager.ts#L34), [DbTextManager.ts:10](../module/core/lib/DbTextManager.ts#L10) | nothing: one object per file/text id, per app |
| [geocode.ts:35](../module/cms.cont.map.openstreet/lib/geocode.ts#L35) — miss cache | nothing: one entry per distinct address string |
| [templateParser/mod.ts:11](../module/cms.templateParser/mod.ts#L11) — parsed ASTs | number of template files; remote templates never revalidate |
| [Db.ts:186](../module/core/lib/db/Db.ts#L186) — schema in memory | table × column count, loaded at boot and on every module install |

### The big one: node caching

`CMS.#nodes` holds a `Promise<Node>` per id, and each `Node` lazily holds its texts, files, urls and
children ([Node.ts:33-38](../module/cms/lib/Node.ts#L33-L38)). Nodes are strong references, so the
`DbRow` identity map underneath — which is `WeakRef`-based and would otherwise collect
([DbTable.ts:285](../module/core/lib/db/DbTable.ts#L285)) — cannot release anything a node still points
at. On a site with many pages, memory tracks "pages ever requested since boot", not "pages in use".

`scopeCache()` ([dbScope.ts:22](../module/core/lib/db/dbScope.ts#L22)) swaps these caches for a
request-local one while a db scope is active (versions/draftmode), so those do not accumulate.

### Request bodies

`ReqBody.parse` calls `.json()` / `.formData()` on a clone — the whole body materializes in RAM,
capped only by `uploadMaxFileSize`. Files are spooled to disk *afterwards*
([ReqBody.ts:35](../module/core/lib/ctx/ReqBody.ts#L35) → [fileStream.ts:24](../module/core/lib/fileStream.ts#L24)),
which does not help the multipart parse that already buffered them. Ten concurrent 100 MB uploads is
a gigabyte. Lower `core.uploadMaxFileSize` on sites that do not need large uploads.

Bodies without a valid `content-length` go through [`cappedResponse`](../module/core/lib/ctx/ReqBody.ts#L87),
which collects chunks into an array — same cap, same peak.

## Disk

| Where | Grows with | Cleaned by |
|---|---|---|
| [App.ts:97](../module/core/lib/App.ts#L97) `cache/core/file/` | every distinct file × transform-option combination | only the manual health-check cleanup |
| [ModuleManager.ts:95-97](../module/core/lib/ModuleManager.ts#L95-L97) `cache/<mod>/`, `tmp/<mod>/` | per module, module's own discipline | `tmp/` via the same cleanup |
| [DbFileManager.ts](../module/core/lib/DbFileManager.ts) — stored files | uploads; rows orphaned when their owner is deleted | `cleanup["unused dbFiles"]` |
| [plugin.ts:193](../module/cms/plugin.ts#L193) — ZIP export | a temp dir of symlinks per download | on process exit; killed on client abort |
| [FileTransformer.ts:156](../module/core/lib/transform/FileTransformer.ts#L156) — `filetransform_*` | one temp dir per running transform | `finally` in the same function |
| [instanceMarker.ts:11](../module/cms.backend.system/lib/instanceMarker.ts#L11) | one file per instance, rewritten every 30 s | stale markers on read |

### The transform cache

[`FileTransformer.transform`](../module/core/lib/transform/FileTransformer.ts#L117) writes one file per
`(source, size, options, toolchain, accept)` combination and never deletes. A responsive image with
four widths × three formats × two DPR is 24 files per source image. The only eviction is
[healthChecks.ts:291](../module/core/healthChecks.ts#L291), which deletes entries unused for a chosen
age (three months down to five minutes) — a *manual* cleanup action in the backend, not a scheduled
job. On a busy site this is the fastest-growing directory on the machine. Cache hits touch `mtime`
(at most once a day, since `atime` is unreliable) so the age is meaningful
([FileTransformer.ts:151](../module/core/lib/transform/FileTransformer.ts#L151)).

### Database growth

The access log is the dominant writer. [`initLog`](../module/core/lib/ctx/init.ts#L62) runs on **every**
request and writes up to five rows: `log`, plus `log_url`, `log_ip`, `log_user_agent` dictionary
entries on first sight, plus the redacted POST body (clipped to 10 000 chars) inline in `log.post`.
Other steady growers: `sess`, `client`, and `smalltext`, which gains a row for every new
translatable string.

Cleanup lives in [healthChecks.ts:225](../module/core/healthChecks.ts#L225) — deletes logs older than a
month and unreferenced clients and sessions, and clears tokens of idle sessions. It is
operator-triggered.

## CPU

| Where | Cost |
|---|---|
| [login.ts:135](../module/core/lib/auth/login.ts#L135) — bcrypt cost 10 | ~50-100 ms of **blocking** JS per hash; `bcryptjs` is pure JS, no thread pool |
| [transform/](../module/core/lib/transform/) — magick, ffmpeg, tesseract, pandoc | subprocesses; the only real CPU consumers, capped by [limit.ts](../module/core/lib/transform/limit.ts) |
| [sanitize.ts](../module/cms/lib/sanitize.ts) — `sanitize-html` | a full HTML parse per text, on every render path; cached |
| [LangManager.ts:116](../module/core/lib/LangManager.ts#L116) — md5 per `t\`\`` call | cheap alone, once per translatable string per render |
| [init.ts:62](../module/core/lib/ctx/init.ts#L62) — logging | md5 of url and referer, plus the JSON stringify of the body, per request |
| [Node.bough()](../module/cms/lib/Node.ts#L324) | recursive: one children-query per node in the subtree |
| [Db.loadTables()](../module/core/lib/db/Db.ts#L178) | full introspection at boot and after every module install |

### bcrypt blocks the event loop

`bcryptjs` has no native backend. A login costs ~100 ms during which the isolate serves nothing else,
and [login.ts:16](../module/core/lib/auth/login.ts#L16) deliberately compares against a dummy hash for
unknown users — so the cost applies to failed logins too, which is exactly what a credential-stuffing
run produces. The same holds for [auth.backup_codes](../module/auth.backup_codes/mod.ts#L43), which tries
codes one by one.

### Subprocesses

Every external tool goes through [`limited()`](../module/core/lib/transform/limit.ts), which caps
concurrency at `hardwareConcurrency` and queues the rest — waiting, never rejecting. The cap exists
for memory, not CPU: decoders hold their peak simultaneously. Per-pipeline timeout is 600 s by default
([FileTransformer.ts:51](../module/core/lib/transform/FileTransformer.ts#L51)); an in-flight identical
request is deduplicated via `#running` rather than started twice.

`ImageMagick` on a large source, `ffmpeg` on video, and `tesseract` OCR at 300 dpi
([ocr.ts:14](../module/core/lib/transform/ocr.ts#L14)) are the heaviest. Capability probes are cached but
re-run after `resetCapabilityCache()`.

### Per-request baseline

`initRequest` ([init.ts:10](../module/core/lib/ctx/init.ts#L10)) fires `authenticate`, loads or creates
the client row, resolves the session, preloads `usr`, loads settings and language, and starts the log
write. On a cold cache that is a handful of queries before any route runs. The log write is
fire-and-forget — `ctx.logId` is a promise, and awaiting it inside an `*-after` hook deadlocks.

## Not resource hotspots

Worth stating, because they look like they should be:

- **Cron** ([scheduler.ts](../module/cron/scheduler.ts)) — one unref'd timer per app, polls every 60 s by
  default, concurrent runs share one promise.
- **Session data** — stored in the `sess` row, not in process memory.
- **DbRow identity maps** ([DbTable.ts:285](../module/core/lib/db/DbTable.ts#L285)) — `WeakRef` plus a
  `FinalizationRegistry`, self-cleaning as long as nothing holds a strong reference.
- **uncdn** ([mod.ts](../module/uncdn/mod.ts)) — 1 MB per asset, 50 MB total by default.

## Knobs

| Setting | Effect |
|---|---|
| `core.uploadMaxFileSize` | the RAM peak of one request body; 100 MB by default |
| `cron.pollSeconds` | scheduler wake-up interval |
| `setMaxProcesses(n)` ([limit.ts](../module/core/lib/transform/limit.ts)) | concurrent external tools |
| `FileTransformer` `timeout` | seconds before a transform pipeline is killed |
| `core.smalltext.counter` | off by default; on, it adds an UPDATE per translated string |
