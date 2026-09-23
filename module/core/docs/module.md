# Modules

A module is a folder with a `manifest.json` and a `plugin.ts` (or `.js`/`.mjs`). The
`ModuleManager` (`lib/ModuleManager.ts`) imports plugins, runs their hooks in dependency
order and can **link/unlink** them at runtime.

## Manifest and plugin

`manifest.json` says what a module *is* — everything a store or installer must know **before**
its code runs:

```json
{
  "name": "shop",
  "description": "Sells things.",
  "dependencies": ["core"]
}
```

`plugin.ts` says what it *does*:

```ts
export const settingsSchema = { … }; // app-wide settings, under settings.<name>
export const ctxSettingsSchema = { … }; // per-request settings, under ctx.settings.<name>
export const dbSchema = { … };       // tables this module owns (see below)

export const api = { … };            // api tree, mounted at apiTree.<name> (→ /api/<name>/…)

export function init(app, { signal }) { … }   // wire up listeners/timers/routes
export async function install({ app, module }) { … }   // once per app: seed content
export async function uninstall({ app, module }) { … } // …and remove it again
```

That is the only rule for the manifest. A schema is data too, but nobody needs it before the
module is linked, so it stays in the plugin.

Everything is optional, both files included — a module may consist only of
`export function init(app) {}`. The name comes from the folder or the store; `name` in the
manifest is only a check, and a mismatch fails the boot. A module that needs its own name reads
the manifest:

```ts
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;
```

The loader first **reads** the manifest, then **imports** the plugin. So a store can list a
module, and an installer refuse one, without running its code. At runtime both are on the
`Module`: `mod.manifest`, `mod.name`, `mod.description`, `mod.dependencies`. The public API
belongs in `mod.ts`.

## Public imports

Within a module, use relative paths. Across modules, import the public package entrypoint, not
the other module's files:

```ts
import { html, type App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { send } from "@qino/qino/messaging";
```

During development, `name` and `exports` in `deno.json` resolve these to the package itself. JSR
rewrites them to full specifiers on publish, so consumers need no import map. A module copied as
source needs its application to map `@qino/qino` to a version.

## Module names

A name is `[<role prefix>.]<vendor>.<name>`, e.g. `cms.cont.acme.blog` or `acme.shop`. Qino's own
modules have no vendor segment.

The name is the api tree key, the locale namespace, the settings key, the `/m/<name>/pub/` route
and what `dependencies` refer to. It cannot be renamed later.

- **Role prefixes** say where a module plugs in — `CMS.getModules()` looks for `cms.cont.`,
  `getLayouts()` for `cms.layout.`. Qino defines and reserves them.
- **The vendor segment** follows the role prefix and belongs to the publisher, so two stores don't
  collide: `cms.cont.acme.blog` vs `cms.cont.other.blog`.

Open: a third party with its own plug-in point has no place for a new role prefix. The fix would be
to move the role from the name into the manifest — `cms.cont.*` and `cms.layout.*` look the same
there (both export `cms.node.render`), only the name tells them apart.

## Files

A module gets three directories below `app.dir`, named after the module. They differ only in
what may be deleted:

| Accessor | Directory | May be deleted |
|---|---|---|
| `mod.data` | `data/<module>/` | never |
| `mod.cache` | `cache/<module>/` | any time |
| `mod.tmp` | `tmp/<module>/` | when nothing runs |

So `tmp/` can be cleared on boot, and `tmp/` + `cache/` can be dropped to free space. Below the
module name the layout is yours.

**Backup: save all of `app.dir` except `cache/` and `tmp/`, and dump the database instead of
copying it.** Excluding is safer than listing what to keep — anything unknown ends up in the
backup, e.g. `server.ts`, a store folder or the SQLite file in `app.dir`. Copying a live database
file can give a broken copy, so dump it: `VACUUM INTO` for SQLite, `mysqldump` / `pg_dump`
otherwise.

**Rule:** everything in `cache/` must be rebuildable without the backup — from `data/` or from
where it was fetched. Originals belong in `data/`; mirrored files of a remote module belong in
`cache/`. `cache/` may be cleared during a request; `tmp/` may not, since a running upload or zip
build would break.

The accessors are plain strings; create the directory where you write:

```ts
const dir = mod.cache;
await Deno.mkdir(dir, { recursive: true });
await Deno.writeTextFile(dir + key + ".json", body);
```

Files in `data/<module>/pub/` are served at `Module.dataUrl` (`<appUrl>d.<rev>/<module>/`), like
the module's code under `<appUrl>m.<rev>/<module>/pub/` (`ctx.req.moduleUrl`). Nothing else in
`data/` is reachable over HTTP.

`<rev>` is `app.assetRev`, the newest mtime of any served file in base 36. The server ignores it
when resolving the path. With it the response is `immutable` for a year, without it `no-cache`.
So use `mod.modUrl` / `mod.dataUrl` and, in browser code, the `@qino/m/<module>/` specifier —
never a literal `/m/…` path, which bypasses caching. Code that writes below a `pub/` dir sets
`app.assetRev = unixTime()`; linking a module includes its own files.

Uploads belong to core: `data/core/file/`, managed by `app.dbFiles`.

## Lifecycle

Three phases; at runtime the same steps work for one module:

| | Boot (all modules) | Runtime (one module) |
|---|---|---|
| register | `app.modules.add(spec)` / `store.add(name)` | `await app.modules.import(spec)` |
| run hooks | `await app.init()` | `await app.modules.link(name)` |
| tear down | — | `app.modules.unlink(name)` |

- **`modules.add(spec)`** registers a local or remote module; `init()` imports it later. `App`
  adds `core` itself.
- **`store.add(name)`** registers `<name>/plugin.ts` from a store. `await store.addAll()` registers
  all modules of the store.
- **`import(spec)`** loads a module right away for runtime linking. It runs **no** hooks.
- **`init()`** boots: migrate the merged DB schema, apply all settings schemas, then run all hooks
  in dependency order.
- **`link(name)`** runs the hooks of one imported module. Idempotent; its `dependencies` must be
  linked first. **`unlink(name)`** reverses it.

```ts
// add a module while the app is running
await app.modules.import("file:///…/shop/plugin.ts");
await app.modules.link("shop");
// …later
app.modules.unlink("shop");
await app.modules.link("shop"); // re-link is fine — the module stays registered
```

`add()` and `import()` last for one boot. `modules.install(spec)` stores the module in the
`module` table and links it; `modules.uninstall(name)` reverses that and runs the `uninstall()`
hook. `store.install(name)` does the same for a store module — use it when the name comes from
request input. See [stores.md](stores.md#installing-at-runtime). Install wraps link: unlinking
keeps the data.

## Writing a hot-plug-safe module

`init(app, { signal })` gets an `AbortSignal` that fires on unlink. **Register everything with
it**, then unlink cleans up by itself:

```ts
export function init(app, { signal }) {
  app.on("route", onRoute, { signal });          // auto-removed on unlink
  const timer = setInterval(tick, 60_000);
  signal.addEventListener("abort", () => clearInterval(timer), { once: true });
}
```

Without `{ signal }`, a listener keeps running after unlink. Each link gets a **new** signal.

## What link/unlink touch

| Set up by `init()`/hooks | Removed by `unlink` |
|---|---|
| `app.on(...)` listeners, timers (via `signal`) | signal aborts → listeners off, timers cleared |
| `apiTree[name]` (the module's `api`) | deleted |
| settings & ctx settings schema | rebuilt from the remaining linked modules |

**Kept on purpose, because it is data:**

- **DB tables.** Migration only adds (`patch: true`). Neither `unlink` nor `uninstall` drops a
  table; a module deletes its rows in `uninstall()` if it wants to.
- **Locales** in `smalltext` (only empty rows are filled).
- **`install()` content.** It runs once per app, not per link. Only `uninstall` removes it, via
  the module's `uninstall()` hook.

## Dependencies & ordering

Modules are sorted by `dependencies`; cycles are refused. A module is linked after its
dependencies and cannot be unlinked while another linked module needs it. Settings schemas are
applied *before* any hook, so `init()`/`install()` see the defaults of all linked modules.

## DB schema

`dbSchema` is an object (the module's tables) or a function `(merged) => schema` that builds
tables from the merged schema of the other modules; functions run after all objects. Both are
merged and migrated on `init`/`link`.

## Not yet torn down on unlink

Registries without a remove API keep a stale entry after unlink:

- **`ai`** — `registerAiOcr` / `registerAiTranscript` add engines to `app.fileTransformer`;
  `FileTransformer` has no unregister.
- **`ai` / `cms.frontend.ai`** — `AiApi.registerBot(...)` writes into a `Map` with no unregister.

Fix when needed: accept a `signal` (e.g. `registerOcrEngine(engine, { signal })`) or return a
dispose function.
