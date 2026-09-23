# Core docs

The core boots the app, loads modules, opens the database and serves files.

- **[Modules](module.md)** — a module is a folder with `manifest.json` and `plugin.ts`. The
  `ModuleManager` runs their hooks in dependency order and can link/unlink them at runtime.
  Start here.

- **[Module stores](stores.md)** — optional catalogs of modules: `add()` for one boot,
  `install()` to keep them, local sources vs. JSR.

- **[Database access](db.md)** — `` sql`…` `` fragments, `db.query`/`exec` to run them, and
  `db.table()` CRUD helpers. The same code runs on MySQL, SQLite and PostgreSQL.

- **[File transforms](transform.md)** — derives files on demand: resize and re-encode images,
  render PDF pages, extract video frames, OCR and transcription. Results are cached on disk.
