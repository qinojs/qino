# Module stores: decisions and current state

Stand: 1. August 2026

## Goal

Qino modules should not depend on one central registry. Qino itself, third parties, projects, and
developers should all be able to provide modules from their own locations. A project may combine
several stores and individual local modules.

A store is therefore only a catalog layer above ordinary modules:

- A module is independently loadable from its `plugin.ts`.
- A store gives module names conventional URLs and allows selecting one or all of them.
- A module does not need to know its store.
- An application does not need a store to add an individual module.

This keeps the module contract small and prevents the store from becoming a mandatory central
service.

## Chosen API

Boot configuration is declarative and synchronous. Loading happens later in `app.init()`:

```ts
const base = import.meta.resolve("./");
const url = (path: string): string => new URL(path, base).href;

app.modules.add(url("./local/hello.world/plugin.ts"));

const store = app.stores.add(url("./vendor/store.json"));
store.add("hello.analytics");

app.stores.add(url("./qino/module/store.json")).addAll();

await app.init();
```

The same verb is used at both layers because both calls declare a module for boot:

- `app.modules.add(spec)` adds an individual module.
- `store.add(name)` adds an individual module from a catalog.
- `store.addAll()` adds the complete catalog.
- `app.stores.add(spec)` adds or returns a store.

`add` was chosen over the other candidates for these reasons:

- `use` commonly means ordered middleware in Express, Hono, and similar frameworks.
- `import` suggests that the module is loaded immediately and is also a JavaScript keyword.
- `load`, `activate`, `mount`, and `link` suggest an immediate runtime effect.
- `install` already describes persistent installation work and is a module hook.
- `registerModule`, `addModule`, and similar names repeat the receiver (`modules`).

`app.import(spec)` remains the immediate runtime operation. A runtime module is imported first and
then linked explicitly. `link` and `unlink` keep their existing lifecycle meaning.

The old `importAll` directory scan was removed. Adding every module is now exclusively a store
operation, except for the temporary PostgreSQL demo compatibility scan described below.

## Minimal module contract

A module may contain only this:

```ts
export function init(app) {}
```

Every manifest field is optional. In particular, `name` is no longer mandatory:

- A store supplies the catalog name.
- A directly added conventional `<name>/plugin.ts` infers its name from the parent directory.
- An explicitly exported `name` is still supported.
- If a store name and an exported name differ, boot fails instead of silently changing identity.

Module names are validated. Duplicate names, duplicate URLs under different names, missing
dependencies, and dependency cycles fail explicitly. Stores do not overwrite each other in a map;
there is currently no implicit precedence or local-wins policy. Failing loudly keeps every later
option open — an apt-style priority rule can still be added, silent shadowing could not be taken
back. What keeps two stores from colliding in the first place is the vendor segment in the module
name; see [module.md](module.md#module-names).

## Store format and URL convention

The minimal catalog is deliberately metadata-friendly:

```json
{
  "modules": {
    "hello.world": {},
    "hello.analytics": {}
  }
}
```

The catalog URL is the base. A module named `hello.world` resolves to:

```text
<catalog directory>/hello.world/plugin.ts
```

The empty objects reserve a place for future metadata without requiring any feature now. Unknown
metadata can be ignored. The current implementation only validates that every value is an object.

Store catalogs can currently be read from `file:`, `http:`, and `https:` URLs. The store validates
its shape, module names, and selected names before queueing plugins in the module manager.

## URL resolution

A function that receives only `"../module/plugin.ts"` cannot know which source file called it.
Relative strings passed to `app.modules.add()` are therefore resolved against `app.appPATH`, not
against the caller's `import.meta.url`.

Call sites that mean “relative to this source file” resolve while that context still exists. `add()`
takes a `URL` as well as a string, so that is the whole pattern:

```ts
app.modules.add(new URL("../modules/example/plugin.ts", import.meta.url));
```

The demos additionally keep a small `url()` helper, because `appPATH` and similar options still want
a string. No API can reconstruct caller context from a plain string, so the caller has to supply it
one way or the other.

## Local source development and JSR

Modules consume public Qino APIs through canonical specifiers such as:

```ts
import { html, type App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { scored } from "@qino/qino/score";
```

The source stays identical in both environments, and nothing has to be redirected by hand: the
repository root is a Deno workspace whose members are `qino/` and the demos. Inside it, `@qino/qino`
resolves to the local source tree because `qino/` is the package of that name; outside it, the same
specifier resolves to the published JSR package. That covers the demos, `test-modules/`, and
`privat-module/` alike — a plain directory inside the workspace can import a member by name.

Third-party versions are pinned once, in [`qino/deno.json`](../../../deno.json) `imports`. Module
sources only ever write bare specifiers (`@std/media-types`, `@qino/item/tools/db/sql.js`), so a
version bump is a single edit and Deno's `no-import-prefix` lint stays satisfied.

To work against a local item.js checkout, uncomment `patch` in the workspace root `deno.json` —
Deno then resolves `@qino/item/` to the working copy instead of JSR. The `patch` entry only applies
if the local version satisfies the pinned range, which is why the range is `^0.6.3` rather than an
exact version; `deno.lock` keeps the actual resolution reproducible.

`import.meta.resolve("jsr:...")` may continue to return an opaque `jsr:` specifier. It is useful for
loading but not a reliable hierarchical asset URL. Consequently a store itself currently needs a
real hierarchical `file:`, `http:`, or `https:` URL. Exporting `const url = import.meta.url` from
every plugin was not adopted: the module manager already knows the specifier it imported, and an
opaque JSR URL would not solve public assets or directory enumeration.

## Concrete implementation changes

### Core

- [`ModuleManager`](../lib/ModuleManager.ts) now has synchronous `add()`, a pending queue, optional
  manifest names, conventional name inference, name validation, and duplicate checks.
- `ModuleManager.init()` imports the pending queue before dependency ordering, schema migration,
  settings, locales, installation, and module initialization.
- `ModuleManager.importAll()` and the `App.importAll()` facade were removed.
- [`StoreManager`](../lib/StoreManager.ts) and `Store` implement catalog loading, selection, and
  conventional module URLs.
- [`App`](../lib/App.ts) owns one `StoreManager` per application instance. Stores initialize before
  modules, keeping all state tenant-local.

### Catalogs

- [`module/store.json`](../../store.json) is the standard Qino store and currently lists 87 modules.
- [`test-modules/store.json`](../../../test-modules/store.json) is an optional test store with six
  modules.
- The separate `experimental-modules/store.json` catalog currently lists 21 experimental modules.

The test store contains:

- `cms.cont.example`
- `cms.cont.example.ml`
- `cms.cont.my.debug`
- `cms.cont.cms-image2-test`
- `cms.cont.apitest`
- `cms.backend.superuser.score.test`

These modules were moved out of the standard store. Their runtime code imports Qino only through
public package exports, which makes the store a practical isolation test for a later repository or
package split. `cms.backend.api` stayed in the standard store because it is a regular API explorer
and documentation module, not a test fixture.

`qino/cms` and `qino/cms-tests` were deliberately not introduced yet. That move would already be
the real CMS package split and would mix a large import rewrite into the store experiment.

### Demos and documentation

- The SQLite, MySQL, multi-tenant, and PostgreSQL demos load the relevant store catalogs.
- Demo boot configuration uses the shared `base`/`url` resolver shown above.
- Demos are workspace members; no per-demo import map.
- Module usage documentation now uses `app.modules.add()` for boot and preserves `app.import()` for
  actual runtime loading.

## Tests and guardrails

The boundary and module-manager tests now verify:

- direct modules without an exported name;
- selective `store.add()` and complete `store.addAll()`;
- deterministic catalog order;
- catalog validity and existence of selected modules;
- exact agreement between each catalog and its plugin directories;
- importability of every test-store plugin;
- no runtime import from a test-store module into Qino internals;
- existing duplicate, missing-dependency, and cycle errors.

The previously failing `cms.cont.html` CSS test was also corrected: the CSS generator intentionally
adds explanatory comments, while its older test still expected the original empty template.

## Deliberately deferred work

### Remote public assets

Plugin imports work over HTTP, but Qino's `/m/<module>/pub/...` route still serves from a local
`Module.dir`. A useful remote store therefore needs a resource strategy: proxy or cache public
assets from a hierarchical module base URL, or install the module locally. This should be proven
with a small HTTP store before moving the CMS store.

### Remote locales

Locales are currently discovered with `Deno.readDir(<module>/locale/)`, which only works for local
directories. Remote modules need an explicit locale export or catalog metadata because HTTP does
not provide portable directory listing. The likely minimal contract is an optional locale object
export; it has not been fixed yet.

### Opaque JSR store locations

JSR is suitable for public code imports, but an opaque `jsr:` value is not yet a store base for
`store.json`, `pub/`, and `locale/`. This remains separate from installing Qino itself through JSR.

### PostgreSQL demo

`demo-postgres/server.ts` temporarily scans the standard module directory and excludes modules
that are not PostgreSQL-compatible. Replacing this with `store.addAll({ except: ... })` would add a
general API solely for one compatibility demo, so the exception remains until either PostgreSQL
support improves or a real selection use case justifies such an API.

### Existing project-wide findings

The store work itself is covered and lint-clean. Full-project checks still expose unrelated older
work: `File.contents()`/`DbFile.contents()` references that do not exist and a larger existing lint
backlog. These were not folded into the store architecture change.

## Recommended next sequence

1. Build a tiny HTTP-hosted store containing `init()`, one `pub/` asset, and one locale.
2. Add a stable module base URL and decide whether remote assets are proxied, cached, or installed.
3. Replace locale directory enumeration with an explicit, optional remote-safe contract.
4. Re-run the test store through both local source mapping and published JSR dependencies.
5. Only then split the CMS modules into their own package/store and later their own repository.

