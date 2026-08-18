# Modules

A module is a folder with a `manifest.json` and a `plugin.ts` (or `.js`/`.mjs`). The
`ModuleManager` (`lib/ModuleManager.ts`) imports plugins, runs their hooks in dependency
order, and can **link/unlink** them at runtime without a restart.

## Manifest and plugin

A module is two files. `manifest.json` says what it *is* — everything a store, an installer or a
mirror has to know **before** any of its code runs:

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

"Known before the code runs" is the whole rule, and it is what keeps the manifest from growing into
Chrome's, where it became the API surface: a schema is data too, but nobody needs it before the
module is linked.

Everything is optional, both files included — a module may consist only of
`export function init(app) {}`. `name` is a cross-check rather than the identity: the folder or the
store supplies it, and a mismatch fails the boot instead of silently renaming the module. A module
that needs its own name reads it back from the same one truth:

```ts
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;
```

The loader **reads** the manifest and **imports** the plugin, and it does so in that order — which
is why a store can list a module, and an installer refuse one, without executing anything. At
runtime both sit on the `Module`: `mod.manifest`, plus `mod.name`, `mod.description` and
`mod.dependencies` for the fields worth reaching for. Keep the public API in `mod.ts`.

## Public imports

Paths within one module stay relative. Across module boundaries, import the public package
entrypoint instead of another module's files:

```ts
import { html, type App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { send } from "@qino/qino/messaging";
```

The package `name` and `exports` in `deno.json` resolve these as self-references during Qino
development. JSR rewrites them to fully qualified specifiers on publish, so a consumer may import
Qino directly with `jsr:@qino/qino@<version>` without inheriting Qino's import map. A separately
copied source module still needs its application to map `@qino/qino` to the desired version.

## Module names

A name is `[<role prefix>.]<vendor>.<name>`, e.g. `cms.cont.acme.blog` or `acme.shop`. Qino's own
modules omit the vendor segment — that absence is what marks them as core.

The name is not just a label: it is the api tree key, the locale namespace, the settings key, the
`/m/<name>/pub/` route, and what other modules reference in `dependencies`. It can therefore never be
renamed after the fact, which is why the two things it encodes need fixed positions.

- **Role prefixes** say where a module plugs in and are looked up by prefix — `CMS.getModules()`
  scans `cms.cont.`, `getLayouts()` scans `cms.layout.`. They are defined and reserved by Qino.
- **The vendor segment** follows the role prefix and belongs to whoever publishes the module. It
  is what keeps two stores from colliding: `cms.cont.acme.blog` vs `cms.cont.other.blog`.
  Uniqueness inside one vendor is that vendor's own problem.

Open: a third party that brings a new plug-in point of its own has nowhere to put a role prefix,
because the prefix set has no owner. Solving that means moving the role out of the name into the
manifest — today `cms.cont.*` and `cms.layout.*` are structurally identical there (both export
`cms.node.render`), so only the name distinguishes them.

## Files

A module gets three directories below `app.dir`, each named after the module. They differ in
one thing only — what an operator may throw away:

| Accessor | Directory | May be deleted |
|---|---|---|
| `mod.data` | `data/<module>/` | never |
| `mod.cache` | `cache/<module>/` | any time |
| `mod.tmp` | `tmp/<module>/` | when nothing runs |

That split is what makes the operator's jobs one path each: clear `tmp/` on boot, drop `tmp/` +
`cache/` to reclaim space. Below the module name the layout is yours.

**Backing up follows from it, and is stated the other way round: save all of `app.dir` except
`cache/` and `tmp/`, the database dumped rather than copied.** Excluding is the safe direction —
whatever nobody classified is in the backup instead of missing from it, and it is missing that you
notice at restore time. A whitelist would also have to name everything that is neither a module
directory nor derived: the app's own `server.ts`, a store folder, and with SQLite the database file,
which sits directly in `app.dir`. Copying that file while the app runs gives a torn copy, hence the
dump — `VACUUM INTO` for SQLite, `mysqldump` / `pg_dump` otherwise.

**The invariant that carries it:** everything in `cache/` must be reproducible from `data/` alone.
Otherwise "deletable" is not safe — so originals belong in `data/`, only derivatives in `cache/`.
`tmp/` is separate from `cache/` because of *when* it may go: `cache/` can be cleared mid-request
without breaking anything, `tmp/` cannot — a running upload or zip build dies with it.

The accessors are plain strings; create the directory where you write:

```ts
const dir = mod.cache;
await Deno.mkdir(dir, { recursive: true });
await Deno.writeTextFile(dir + key + ".json", body);
```

What lies in `data/<module>/pub/` is served at `Module.dataUrl` (`<appUrl>d/<module>/`), the
counterpart to the module's own code under `<appUrl>m/<module>/pub/` (`ctx.req.moduleUrl`).
Nothing else below `data/` is reachable over HTTP.

Uploads are core's: `data/core/file/`, managed by `app.dbFiles`.

## Lifecycle

Three separate phases — runtime mirrors boot, one module at a time:

| | Boot (all modules) | Runtime (one module) |
|---|---|---|
| register | `app.modules.add(spec)` / `store.add(name)` | `await app.modules.import(spec)` |
| run hooks | `await app.init()` | `await app.modules.link(name)` |
| tear down | — | `app.modules.unlink(name)` |

- **`modules.add(spec)`** declares a local or remote module. `init()` imports it later. `core` is the
  root of the dependency graph, so `App` declares it itself — no application has to.
- **`store.add(name)`** declares a module whose conventional `<name>/plugin.ts` location comes
  from a store catalog. `await store.addAll()` declares every module in that catalog.
- **`import(spec)`** immediately loads and registers a module for runtime linking. It does
  **not** run any hooks.
- **`init()`** is the boot step: migrate the merged DB schema, apply all settings schemas, then
  run every module's hooks in dependency order.
- **`link(name)`** runs one already-imported module's hooks. Idempotent; its `dependencies` must be
  linked already. **`unlink(name)`** reverses them.

```ts
// add a module while the app is running
await app.modules.import("file:///…/shop/plugin.ts");
await app.modules.link("shop");
// …later
app.modules.unlink("shop");
await app.modules.link("shop"); // re-link is fine — the module stays registered
```

`add()` and `import()` last for one boot. `modules.install(spec)` is the persistent version —
it remembers the module in the `module` table and links it, `modules.uninstall(name)` reverses
that including the `uninstall()` hook. `store.install(name)` is the same for a module of a store,
and the form to use when request input is involved. See
[stores.md](stores.md#installing-at-runtime); the two lifecycles nest, so linking presumes an
install and unlinking keeps the data.

## Writing a hot-plug-safe module

`init(app, { signal })` receives an `AbortSignal` that fires when the module is unlinked.
**Register everything through it** so unlink tears it down automatically:

```ts
export function init(app, { signal }) {
  app.on("route", onRoute, { signal });          // auto-removed on unlink
  const timer = setInterval(tick, 60_000);
  signal.addEventListener("abort", () => clearInterval(timer), { once: true });
}
```

Without `{ signal }`, a listener keeps firing after unlink — nothing crashes, but the module
isn't fully gone. Each link gets a **fresh** signal, so re-linking rebinds cleanly.

## What link/unlink touch

| Set up by `init()`/hooks | Removed by `unlink` |
|---|---|
| `app.on(...)` listeners, timers (via `signal`) | signal aborts → listeners off, timers cleared |
| `apiTree[name]` (the module's `api`) | deleted |
| settings & ctx settings schema | rebuilt from the remaining linked modules |

**Kept on purpose — this is data, not runtime state:**

- **DB tables.** Migration is additive (`patch: true`) and never drops. Neither `unlink` nor
  `uninstall` drops a table; a module that wants its rows gone deletes them in `uninstall()`.
- **Locales** seeded into `smalltext` (additive, only fills empty rows).
- **`install()` content.** It runs once per app, not per link — `unlink` does not undo it, only
  `uninstall` does, through the module's own `uninstall()` hook.

## Dependencies & ordering

`dependencies` defines a partial order; the manager topologically sorts it and refuses cycles. A module
is linked only after its `dependencies`, and cannot be unlinked while another linked module needs it.
Settings schemas are applied *before* any hook runs, so `init()`/`install()` already see every
linked module's defaults.

## DB schema

`dbSchema` is either a static object (the module's own tables) or a function
`(merged) => schema` that computes tables from the already-merged schema of other modules — it
runs after all static schemas. Both are merged and migrated additively on `init`/`link`.

## Not yet torn down on unlink

Everything registered through `{ signal }` (listeners on `app` and `app.db`, timers) is now
removed on unlink. What is **not** cleaned up yet are registrations into shared registries that
have no removal API — they keep a stale entry after unlink:

- **`ai`** — `registerAiOcr` / `registerAiTranscript` add engines to `app.fileTransformer`;
  `FileTransformer` has no unregister.
- **`ai` / `cms.frontend.ai`** — `AiApi.registerBot(...)` writes into a `Map` with no unregister.

To make these unlink-clean, the registries need either a `signal` argument or a returned dispose
handle (e.g. `registerOcrEngine(engine, { signal })`). Small API addition, no behaviour change —
deferred until module disable/enable actually needs it.
