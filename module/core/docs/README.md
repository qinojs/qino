# Core docs

The core is the foundation the rest of qino builds on: it boots the app, loads modules, opens
the database, and serves files. These guides cover the building blocks you'll touch most —
start here, then dive into a topic.

- **[Modules](module.md)** — the unit everything ships in. A module is a folder with a
  `plugin.ts` manifest; the `ModuleManager` imports it, runs its hooks in dependency order, and
  can link/unlink it at runtime without a restart. Read this first if you're adding features.

- **[Module stores](stores.md)** — why stores are an optional catalog layer, the chosen `add` API
  and its persistent `install()` counterpart, local source mapping versus JSR, implemented
  safeguards, and the deliberately deferred host allow-list and remote asset/locale work.

- **[Database access](db.md)** — three layers from raw to high-level: composable `` sql`…` ``
  fragments, `db.query`/`exec` to run them, and schema-aware `db.table()` CRUD helpers. Dialect
  (mysql/sqlite/pg) is applied only at render time, so the same code runs on all three.

- **[File transforms](transform.md)** — the `FileTransformer` pipeline that derives files on
  demand: resize/crop/re-encode images, rasterize PDF pages, extract video frames, OCR and
  transcribe. Small phase-ordered transformers, content-addressed disk cache, degrades gracefully
  when a tool is missing.
