# Module stores

A store is a listing above ordinary modules — nothing more:

- a module is loadable on its own, from its `plugin.ts`;
- a store gives module names conventional URLs and lets you pick one or all of them;
- a module never knows its store, and an app needs no store to add a single module.

That is the whole point. Qino, third parties and projects should each be able to publish modules
from their own location, and an application may combine several stores. Keeping the store a thin
listing is what stops it from becoming a mandatory central service.

## API

```ts
app.modules.add(url("./local/hello.world/plugin.ts"));      // one module, by URL

const store = app.stores.add(url("./vendor/store.json"));
store.add("hello.analytics");                               // one module, by name
await app.stores.add(url("./other/store.json")).addAll();   // the whole catalog
await app.stores.add(url("./module/")).addAll();            // a plain folder is a store too

await app.init();
```

`add()` declares for one boot and stays synchronous; `app.init()` imports, orders and links. Because
the module URL is pure convention, `store.add(name)` reads nothing at all — `addAll()` is the one
call that needs the catalog, and it is just `names()` + `add()`. The same two pieces are public for
everyone else: `store.names()` reads the catalog, `store.moduleUrl(name)` builds the URL. The
backend store page is written with them.

## Folder or catalog

A store is really just a folder of module folders, and a local one is read as exactly that: a URL
ending in `/` lists its subfolders, everything else is a `store.json` listing them by name. Only
discovery differs — `moduleUrl(name)` stays `<base><name>/plugin.ts` for both, so a folder can grow
a catalog later without any module changing its address.

The catalog exists because HTTP has no portable directory listing. Some servers do serve an index,
but parsing one is guesswork, so a folder store is `file:` only and a remote one must bring its
`store.json`. That file is also where per-module metadata would go if a store ever needs more than
names — a redirect to another URL, say. Note what such a field would cost: today the module URL is
convention alone, which is why `store.add(name)` reads nothing; an entry that may point elsewhere
makes resolution catalog-dependent and has to move into `init()`.

`core` needs no declaration — it is the root of the `needs` graph, so `App` adds it itself.

A store's own listing is never cached: it may gain modules while the app runs.

## Installing at runtime

`add()` declares for one boot; `install()` is its persistent counterpart, and both managers have it:

```ts
await app.stores.install(catalogUrl);          // remembered in the `store` table
await app.modules.install(pluginUrl, name);    // remembered in the `module` table, then linked
await app.modules.uninstall(name);             // unlink, plugin.uninstall(), row gone
await app.stores.uninstall(catalogUrl);
```

Four verbs, two lifecycles, and they nest: **install** creates what a module owns and **uninstall**
removes it again, while **link** and **unlink** only hook the module into the running app. Linking
therefore requires an install, and unlinking keeps the data.

A module may install other modules from its own `install()` hook — that is how
[cms.installation.default](../../cms.installation.default/plugin.ts) brings a usable CMS without
declaring anything. During boot such an install only registers: `init()` links in passes, so the new
modules get the same ordering and schema merge as the first round instead of a nested `link()` whose
`needs` are not linked yet. Modules that arrive this way are ordinary installed rows — each one can
be uninstalled again, which a `needs` entry could never allow.

Both tables are core's, because both are needed before any module can decide anything:

```text
store:   url
module:  name | url | installed
```

A row means installed, `installed` is when `plugin.install()` ran, and `url` is only set for modules
installed at runtime — those are the ones `init()` has to import again. That is also what
distinguishes the two origins without an extra column:

| | Origin | removable through the UI |
|---|---|---|
| `add()` in server.ts | the application itself | **no** (`declared` is true) |
| row in `store` / `module` | installed at runtime | yes |

`plugin.install()` runs **once per app**, not on every boot — that is what makes `uninstall()`
meaningful, and it means a module whose `install()` used to double as self-healing no longer heals
on restart.

**A module row that no longer imports must not keep the app down.** `init()` logs the failure, skips
the row and remembers it in `modules.failures()`; the store page lists those under *Installed, not
importable* and offers the uninstall that clears the row.

Both managers read their table in `init()` before the schema is migrated, hence the `listTables()`
check: a fresh database has nothing to read yet.

[cms.backend.superuser.stores](../../cms.backend.superuser.stores/) is the UI for all of this.

## Minimal module contract

A module may contain only `export function init(app) {}` — every manifest field is optional,
including `name`:

- a store supplies the catalog name;
- a directly added `<name>/plugin.ts` infers its name from the parent directory;
- an exported `name` still wins, and a mismatch with the store's name fails the boot rather than
  silently changing identity.

Duplicate names, duplicate URLs under different names, missing dependencies and cycles all fail
explicitly. Stores do not overwrite each other, and there is no precedence rule — failing loudly
keeps every later option open, silent shadowing could not be taken back. What keeps two stores from
colliding is the vendor segment in the module name; see [module.md](module.md#module-names).

## Catalog format

```json
{
  "modules": {
    "hello.world": {},
    "hello.analytics": {}
  }
}
```

The catalog URL is the base, so `hello.world` lives at `<catalog directory>/hello.world/plugin.ts`.
The empty objects reserve a place for metadata; only "every value is an object" is validated today,
and unknown keys are ignored. Reading goes through `fetch`, which handles `file:` and `http(s):`
alike.

## URL resolution

A function that receives `"../module/plugin.ts"` cannot know which source file called it. Relative
strings are therefore resolved against `app.appPATH`. Call sites meaning "relative to this source
file" resolve while that context still exists — `add()` takes a `URL` as well as a string:

```ts
app.modules.add(new URL("../modules/example/plugin.ts", import.meta.url));
```

## Local source and JSR

Modules import Qino through canonical specifiers (`@qino/qino`, `@qino/qino/cms`). The repository
root is a Deno workspace with `qino/` and the demos as members, so the same specifier resolves to
the local tree inside it and to the published package outside — demos, `test-modules/` and
`privat-module/` alike. Third-party versions are pinned once in
[`qino/deno.json`](../../../deno.json) `imports`.

An entry point outside the workspace that imports a local checkout must select its config:
`deno run --config=qino/deno.json --frozen …`. To work against a local item.js checkout, uncomment
`patch` in the workspace root `deno.json`.

`import.meta.resolve("jsr:…")` returns an opaque specifier. It loads fine but is not a hierarchical
asset URL, so a store still needs a real `file:`, `http:` or `https:` URL.

## Not there yet

- **Host allow-list and integrity pinning.** Installing a module from a URL is remote code execution
  with full database rights — the deal WordPress and Drupal make, and without it there is no
  ecosystem. Two guards are missing and neither can be added quietly later: a `moduleHosts`
  allow-list in the app config, checked *before* the `import()` (Deno's `--allow-import` cannot do
  it — a process flag would apply to every tenant), and a hash in the `module` row, checked on
  re-import the way `deno.lock` does. Until then, anyone who reaches the store UI can import
  arbitrary code; local `file:` stores are unaffected. A second factor in front of install/uninstall
  would cover the other half — `web_auth` has the ceremony, see `PLAN-confirm.md`.
- **Remote public assets.** Plugin imports work over HTTP, but `/m/<module>/pub/…` still serves from
  a local `Module.dir`. A useful remote store needs a strategy: proxy, cache, or install locally.
- **Remote locales.** Discovery is `Deno.readDir(<module>/locale/)`; HTTP has no portable directory
  listing, so remote modules need an explicit locale export or catalog metadata.
- **PostgreSQL demo.** The `pg` app in `demo/server.ts` installs the default set, which happens to
  avoid what PostgreSQL cannot do yet. A general compatibility-selection API is not worth it yet.
