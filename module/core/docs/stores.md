# Module stores

A store is just a list of ordinary modules:

- a module can be loaded on its own, from its `plugin.ts`;
- a store maps module names to URLs and lets you add one or all of them;
- a module never knows its store, and an app needs no store to add a single module.

So Qino, third parties and projects can each publish modules from their own location, and an app
can combine several stores. No central service is needed.

## API

```ts
app.modules.add(import.meta.resolve("./local/hello.world/plugin.ts")); // one module, by URL

const store = app.stores.add(import.meta.resolve("./vendor/store.json"));
store.add("hello.analytics"); // one module, by name
await app.stores.add(import.meta.resolve("./other/store.json")).addAll(); // the whole catalog
await app.stores.add(import.meta.resolve("./module/")).addAll(); // a plain folder is a store too

await app.init();
```

`add()` registers for one boot and is synchronous; `app.init()` imports, orders and links. The
module URL follows from the name, so `store.add(name)` reads nothing. Only `addAll()` reads the
catalog; it is `names()` + `add()`. These parts are public: `store.names()` reads the catalog,
`store.moduleUrl(name)` builds the URL, `store.install(name)` is the runtime version of `add()`.
The backend store page uses them.

## Folder or catalog

A store is a folder of module folders. A URL ending in `/` is read as a folder (its subfolders are
the modules); anything else is a `store.json` that lists them by name. In both cases
`moduleUrl(name)` is `<base><name>/plugin.ts`, so a folder can get a catalog later without any
module moving.

HTTP cannot list directories reliably, so folder stores are `file:` only and a remote store needs a
`store.json`. That file is also the place for per-module metadata if names are ever not enough —
e.g. a redirect. But then `store.add(name)` would have to read the catalog, and resolution would
move into `init()`.

`core` needs no declaration; `App` adds it itself.

**An app declares what it wants, not everything that needs.** For missing dependencies `init()`
calls `modules.locate()`, which the `StoreManager` provides: declaring `mail` brings `messaging`
from whatever store has it. Installing does the same and stores each module, so each can be
uninstalled later. Dependencies no store offers are reported as missing.

Through this hook `ModuleManager` needs to know nothing about stores; otherwise the two managers
would depend on each other.

A store's listing is never cached: it may get new modules while the app runs.

## Installing at runtime

`add()` registers for one boot; `install()` persists. Both managers have it:

```ts
await app.stores.install(catalogUrl);          // stored in the `store` table
await store.install(name);                     // stored in the `module` table, then linked
await app.modules.install(pluginUrl, name);    // the same, for a module without a store
await app.modules.uninstall(name);             // unlink, plugin.uninstall(), row gone
await app.stores.uninstall(catalogUrl);
```

**install** creates what a module owns, **uninstall** removes it. **link** and **unlink** only
attach the module to the running app. So linking requires an install, and unlinking keeps the data.

`store.install(name)` builds the URL like `store.add(name)`. Use this form whenever request input
is involved: **code that takes a name never handles an import URL.** Importing a module runs server
code, so registering a store is a superuser decision, and installing from it relies on that.
Core does not enforce this; `modules.install(url)` stays open, since modules must work without
stores.

A module may install other modules in its `install()` hook — that is how
[cms.installation.default](../../cms.installation.default/plugin.ts) sets up a working CMS.
During boot such an install only registers; `init()` links in passes, so the new modules get the
same ordering and schema merge. They are normal installed rows and can be uninstalled one by one —
a dependency could not.

Both tables belong to core, because they are needed before any module runs:

```text
store:   url
module:  name | url | installed
```

A row means installed; `installed` is when `plugin.install()` ran; `url` is set only for modules
installed at runtime, which `init()` must import again. That also tells the two origins apart:

| | Origin | removable through the UI |
|---|---|---|
| `add()` in server.ts | the application itself | **no** (`declared` is true) |
| row in `store` / `module` | installed at runtime | yes |

`plugin.install()` runs **once per app**, not on every boot — otherwise `uninstall()` would make no
sense. An `install()` that used to repair things on each start no longer does.

**A module row that fails to import must not stop the app.** `init()` logs it, skips the row and
keeps it in `modules.failures()`; the store page lists these under *Installed, not importable*
with an uninstall button.

Both managers read their table in `init()` before migration, hence the `listTables()` check: a new
database has no tables yet.

[cms.backend.superuser.module](../../cms.backend.superuser.module/) is the UI for all of this.

## Minimal module

A module may contain only `export function init(app) {}`. All manifest fields are optional,
including `name`:

- a store supplies the name from its catalog;
- a directly added `<name>/plugin.ts` takes the name of its folder;
- a `name` in the manifest wins, and a mismatch with the store's name fails the boot.

Duplicate names, one URL under two names, missing dependencies and cycles all fail with an error.
Stores never override each other and there is no priority rule — a loud error can be relaxed
later, silent shadowing cannot. Collisions between stores are avoided by the vendor segment; see
[module.md](module.md#module-names).

## Catalog format

```json
{
  "modules": {
    "hello.world": {},
    "hello.analytics": {}
  }
}
```

Paths are relative to the catalog: `hello.world` is at `<catalog directory>/hello.world/plugin.ts`.
The empty objects are reserved for metadata; today only "every value is an object" is checked and
unknown keys are ignored. The catalog is read with `fetch`, so `file:` and `http(s):` both work.

## URL resolution

A function receiving `"../module/plugin.ts"` cannot know which file called it, so relative strings
are resolved against `app.dir`. To resolve relative to the calling file, do it at the call site:

```ts
app.modules.add(import.meta.resolve("../modules/example/plugin.ts"));
```

`new URL("../modules/example/plugin.ts", import.meta.url)` works too; `add()` accepts both.

## Local source and JSR

Modules import Qino via `@qino/qino` and `@qino/qino/cms`. The repository root is a Deno workspace
with `qino/` and the demos as members, so these resolve to the local package for demos,
`test-modules/` and `privat-module/`. A standalone app maps them once to the published package,
which also makes copied modules work:

```json
{
  "imports": { "@qino/qino": "jsr:@qino/qino@^0.6" }
}
```

An app file can also use a full `jsr:` import without config, but module source files with bare
specifiers still need the mapping. To use a local checkout, make `qino/` a workspace member. For a
local item.js checkout, add it to `links` in the root `deno.json`.

`import.meta.resolve("jsr:…")` returns an opaque specifier. It can be imported, but it is not a
normal URL, so a store needs a real `file:`, `http:` or `https:` URL.

### One release, one graph

**A store's files and the `@qino/qino` its modules import must be the same files.** Otherwise both
are loaded twice, and module-level registries such as `cmsInstances` exist twice. A module
registered in one copy is missing in the other:

```
Error: module "cms" is not loaded
```

There is no warning; it just fails at runtime.

So point the store to where the specifier resolves. A local checkout is fine, since everything is
`file:`. For a release, use a registry with stable URLs: `jsr:@qino/qino@^0.6` resolves to
`https://jsr.io/@qino/qino/<version>/…`, and a store at
`https://jsr.io/@qino/qino/<version>/module/store.json` serves modules from the same URLs.

Watch out: a local core plus modules from a remote store is exactly this broken case.

### Public files of a remote module

For a module without a local directory, the `pub/` part of its `manifest.files` is downloaded once
on import into `cache/<name>/remote/`, where the static route looks. So `Module.modUrl` is always an
address of this app — needed e.g. for SVG `<use>`, which does not work across origins.

A mirror is marked with its source only when complete; missing files are fetched again on the next
start, and a health check lists incomplete modules.

## Not there yet

- **Integrity pinning.** Installing a module from a URL runs remote code with full database
  access — like WordPress or Drupal plugins. Registering the store is the superuser decision, but
  nothing ensures that what gets installed is what was reviewed. The fix is a hash in the `module`
  row, checked on re-import like `deno.lock`. Deno's `--allow-import` does not help, since it applies
  to all tenants of the process. A second factor for install/uninstall would also help — `auth`
  has the factors and `auth.webauthn` the ceremony; the step-up guard on the api verb is missing.
- **Locales of a remote module.** Locales are read from `<module>/locale/` in the local `dir`,
  which a remote module lacks — and HTTP cannot list directories. `manifest.files` already has
  the list (see *Public files* above).

  Two more uses of that list are open: copying a remote module into the own store under a new name
  (**fork** — [cms.backend.superuser.module.ownStore](../../cms.backend.superuser.module.ownStore/plugin.ts)
  refuses it today), and generating the list when **publishing**. A publishing app has the
  directory and needs no file; only a static host (CDN, pages) has to keep one.

- **Module versions and rollback.** The store page cannot offer updates without versions. But
  rolling back also needs the host to keep old versions, and `<base><name>/plugin.ts` has no
  version in it. Simpler: version the store via its URL (`…/v2/`). That suits modules developed
  together and needs no resolver — which could not work anyway, since a module name is global and
  two versions cannot coexist.
- **PostgreSQL demo.** The `pg` app in `demo/server.ts` installs the default set, which happens to
  avoid what PostgreSQL cannot do yet. A general compatibility API is not worth it yet.
