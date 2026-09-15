# Resource hotspots

Where a running Qino server spends RAM, disk and CPU. Server-side only — nothing here is about
what a browser does with the delivered page.

Each entry names the code, what it costs, what bounds it, and what makes it grow.

## RAM

| Where | Bound by |
|---|---|
| [CMS.ts:25](../module/cms/lib/CMS.ts#L25) — node identity map | nothing: every node ever touched, per app, for the process lifetime |
| [LangManager.ts:13](../module/core/lib/LangManager.ts#L13) — `smalltext` index | full table per `lang × namespace`, never evicted |
| [ReqBody.ts:52](../module/core/lib/ctx/ReqBody.ts#L52) — body parsing | `core.uploadMaxFileSize`, default 100 MB, **per concurrent request** |
| [sanitize.ts:99](../module/cms/lib/sanitize.ts#L99) — sanitized-HTML cache | 500 entries per policy, but entry size is the text size |
| [limit.ts](../module/core/lib/transform/limit.ts) — external process cap | `navigator.hardwareConcurrency` decoders at their peak |
| [DbFileManager.ts:53](../module/core/lib/DbFileManager.ts#L53), [DbTextManager.ts:21](../module/core/lib/DbTextManager.ts#L21) | nothing: one object per file/text id, per app |
| [geocode.ts:39](../module/cms.cont.map.openstreet/lib/geocode.ts#L39) — miss cache | nothing: one entry per distinct address string |
| [templateParser/mod.ts:9](../module/cms.templateParser/mod.ts#L9) — parsed ASTs | number of template files; remote templates never revalidate |
| [Db.ts:186](../module/core/lib/db/Db.ts#L186) — schema in memory | table × column count, loaded at boot and on every module install |

### The big one: node caching

`CMS.#nodes` holds a `Promise<Node>` per id, and each `Node` lazily holds its texts, files, urls and
children ([Node.ts:28-33](../module/cms/lib/Node.ts#L28-L33)). Nodes are strong references, so the
`DbRow` identity map underneath — which is `WeakRef`-based and would otherwise collect
([DbTable.ts:289](../module/core/lib/db/DbTable.ts#L289)) — cannot release anything a node still points
at. On a site with many pages, memory tracks "pages ever requested since boot", not "pages in use".

`scopeCache()` ([dbScope.ts:26](../module/core/lib/db/dbScope.ts#L26)) swaps these caches for a
request-local one while a db scope is active (versions/draftmode), so those do not accumulate.

### Request bodies

`ReqBody.parse` calls `.json()` / `.formData()` on a clone — the whole body materializes in RAM,
capped only by `uploadMaxFileSize`. Files are spooled to disk *afterwards*
([ReqBody.ts:36](../module/core/lib/ctx/ReqBody.ts#L36) → [fileStream.ts:54](../module/core/lib/fileStream.ts#L54)),
which does not help the multipart parse that already buffered them. Ten concurrent 100 MB uploads is
a gigabyte. Lower `core.uploadMaxFileSize` on sites that do not need large uploads.

Bodies without a valid `content-length` go through [`cappedResponse`](../module/core/lib/ctx/ReqBody.ts#L88),
which collects chunks into an array — same cap, same peak.

## Disk

| Where | Grows with | Cleaned by |
|---|---|---|
| [App.ts:111](../module/core/lib/App.ts#L111) `cache/core/file/` | every distinct file × transform-option combination | only the manual health-check cleanup |
| [ModuleManager.ts:95-97](../module/core/lib/ModuleManager.ts#L95-L97) `cache/<mod>/`, `tmp/<mod>/` | per module, module's own discipline | `tmp/` via the same cleanup |
| [DbFileManager.ts](../module/core/lib/DbFileManager.ts) — stored files | uploads; rows orphaned when their owner is deleted | `cleanup["unused dbFiles"]` |
| [plugin.ts:159](../module/cms/plugin.ts#L159) — ZIP export | a temp dir of symlinks per download | on process exit; killed on client abort |
| [FileTransformer.ts:163](../module/core/lib/transform/FileTransformer.ts#L163) — `filetransform_*` | one temp dir per running transform | `finally` in the same function |
| [instanceMarker.ts:13](../module/cms.backend.system/lib/instanceMarker.ts#L13) | one file per instance, rewritten every 30 s | stale markers on read |

### The transform cache

[`FileTransformer.transform`](../module/core/lib/transform/FileTransformer.ts#L120) writes one file per
`(source, size, options, toolchain, accept)` combination and never deletes. A responsive image with
four widths × three formats × two DPR is 24 files per source image. The only eviction is
[healthChecks.ts:278](../module/core/healthChecks.ts#L278), which deletes entries whose `atime` is older
than two days — a *manual* cleanup action in the backend, not a scheduled job. On a busy site this is
the fastest-growing directory on the machine. Cache hits touch `atime` so the LRU is meaningful
([FileTransformer.ts:157](../module/core/lib/transform/FileTransformer.ts#L157)).

### Database growth

The access log is the dominant writer. [`initLog`](../module/core/lib/ctx/init.ts#L69) runs on **every**
request and writes up to five rows: `log`, plus `log_url`, `log_ip`, `log_user_agent` dictionary
entries on first sight, plus the redacted POST body (clipped to 10 000 chars) inline in `log.post`.
Other steady growers: `sess`, `client`, the security buckets in
[cms.backend.system.security/store.ts](../module/cms.backend.system.security/store.ts), and `smalltext`
which gains a row for every new translatable string.

Cleanup lives in [healthChecks.ts:198](../module/core/healthChecks.ts#L198) — deletes logs, clients and
sessions older than a month, capped at a million rows per statement on MySQL. It is operator-triggered.

## CPU

| Where | Cost |
|---|---|
| [login.ts:133](../module/core/lib/auth/login.ts#L133) — bcrypt cost 10 | ~50-100 ms of **blocking** JS per hash; `bcryptjs` is pure JS, no thread pool |
| [transform/](../module/core/lib/transform/) — magick, ffmpeg, tesseract, pandoc | subprocesses; the only real CPU consumers, capped by [limit.ts](../module/core/lib/transform/limit.ts) |
| [sanitize.ts](../module/cms/lib/sanitize.ts) — `sanitize-html` | a full HTML parse per text, on every render path; cached |
| [LangManager.ts:103](../module/core/lib/LangManager.ts#L103) — md5 per `t\`\`` call | cheap alone, once per translatable string per render |
| [init.ts:69](../module/core/lib/ctx/init.ts#L69) — logging | md5 of url and referer, plus the JSON stringify of the body, per request |
| [Node.bough()](../module/cms/lib/Node.ts#L316) | recursive: one children-query per node in the subtree |
| [Db.loadTables()](../module/core/lib/db/Db.ts#L185) | full introspection at boot and after every module install |

### bcrypt blocks the event loop

`bcryptjs` has no native backend. A login costs ~100 ms during which the isolate serves nothing else,
and [login.ts:16](../module/core/lib/auth/login.ts#L16) deliberately compares against a dummy hash for
unknown users — so the cost applies to failed logins too, which is exactly what a credential-stuffing
run produces. The same holds for [auth.backup_codes](../module/auth.backup_codes/mod.ts#L47), which tries
codes one by one.

### Subprocesses

Every external tool goes through [`limited()`](../module/core/lib/transform/limit.ts), which caps
concurrency at `hardwareConcurrency` and queues the rest — waiting, never rejecting. The cap exists
for memory, not CPU: decoders hold their peak simultaneously. Per-pipeline timeout is 600 s by default
([FileTransformer.ts:52](../module/core/lib/transform/FileTransformer.ts#L52)); an in-flight identical
request is deduplicated via `#running` rather than started twice.

`ImageMagick` on a large source, `ffmpeg` on video, and `tesseract` OCR at 300 dpi
([ocr.ts:13](../module/core/lib/transform/ocr.ts#L13)) are the heaviest. Capability probes are cached but
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
- **DbRow identity maps** ([DbTable.ts:289](../module/core/lib/db/DbTable.ts#L289)) — `WeakRef` plus a
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
| security `allowedPaths` / `suspiciousPaths` | how many requests reach the bucket store |
