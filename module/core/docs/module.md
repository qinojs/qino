# Modules

A module is a folder with a `plugin.ts` (or `.js`/`.mjs`) that exports a manifest. The
`ModuleManager` (`lib/ModuleManager.ts`) imports plugins, runs their hooks in dependency
order, and can **link/unlink** them at runtime without a restart.

## The plugin manifest

```ts
export const name = "shop";          // optional; inferred from shop/plugin.ts or its store
export const needs = ["core"];       // module names that must be linked first

export const settingsSchema = { … }; // app-wide settings, under settings.<name>
export const ctxSettingsSchema = { … }; // per-request settings, under ctx.settings.<name>
export const dbSchema = { … };       // tables this module owns (see below)

export const api = { … };            // apt tree, mounted at aptTree.<name> (→ /api/<name>/…)

export function init(app, { signal }) { … }   // wire up listeners/timers/routes
export async function install({ app, module }) { … } // one-time content seeding
```

Everything is optional — a module may consist only of `export function init(app) {}`. `plugin.ts`
is the manifest the loader reads; keep the public API in `mod.ts` (see the module convention).

## Module names

A name is `[<role prefix>.]<vendor>.<name>`, e.g. `cms.cont.acme.blog` or `acme.shop`. Qino's own
modules omit the vendor segment — that absence is what marks them as core.

The name is not just a label: it is the apt tree key, the locale namespace, the settings key, the
`/m/<name>/pub/` route, and what other modules reference in `needs`. It can therefore never be
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

## Lifecycle

Three separate phases — runtime mirrors boot, one module at a time:

| | Boot (all modules) | Runtime (one module) |
|---|---|---|
| register | `app.modules.add(spec)` / `store.add(name)` | `await app.import(spec)` |
| run hooks | `await app.init()` | `await app.link(name)` |
| tear down | — | `app.unlink(name)` |

- **`modules.add(spec)`** declares a local or remote module. `init()` imports it later.
- **`store.add(name)`** declares a module whose conventional `<name>/plugin.ts` location comes
  from a store catalog. `store.addAll()` declares every module in that catalog.
- **`import(spec)`** immediately loads and registers a module for runtime linking. It does
  **not** run any hooks.
- **`init()`** is the boot step: migrate the merged DB schema, apply all settings schemas, then
  run every module's hooks in dependency order.
- **`link(name)`** runs one already-imported module's hooks. Idempotent; its `needs` must be
  linked already. **`unlink(name)`** reverses them.

```ts
// add a module while the app is running
await app.import("file:///…/shop/plugin.ts");
await app.link("shop");
// …later
app.unlink("shop");
await app.link("shop"); // re-link is fine — the module stays registered
```

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
| `aptTree[name]` (the module's `api`) | deleted |
| settings & ctx settings schema | rebuilt from the remaining linked modules |

**Kept on purpose — this is data, not runtime state:**

- **DB tables.** Migration is additive (`patch: true`) and never drops. `unlink` leaves tables
  intact; dropping them is an *uninstall*, not an unlink.
- **Locales** seeded into `smalltext` (additive, only fills empty rows).
- **`install()` content.** `install` runs on every `link`, so it must be idempotent (or track
  "already installed"); `unlink` does not undo it.

## Dependencies & ordering

`needs` defines a partial order; the manager topologically sorts it and refuses cycles. A module
is linked only after its `needs`, and cannot be unlinked while another linked module needs it.
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
