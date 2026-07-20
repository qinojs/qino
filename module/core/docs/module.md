# Modules

A module is a folder with a `plugin.ts` (or `.js`/`.mjs`) that exports a manifest. The
`ModuleManager` (`lib/ModuleManager.ts`) imports plugins, runs their hooks in dependency
order, and can **link/unlink** them at runtime without a restart.

## The plugin manifest

```ts
export const name = "shop";          // required, unique — the registry key
export const needs = ["core"];       // module names that must be linked first

export const settingsSchema = { … }; // app-wide settings, under settings.<name>
export const ctxSettingsSchema = { … }; // per-request settings, under ctx.settings.<name>
export const dbSchema = { … };       // tables this module owns (see below)

export const api = { … };            // apt tree, mounted at aptTree.<name> (→ /api/<name>/…)

export function init(app, { signal }) { … }   // wire up listeners/timers/routes
export async function install({ app, module }) { … } // one-time content seeding
```

Everything except `name` is optional. `plugin.ts` is the manifest the loader reads; keep the
public API in `mod.ts` (see the module convention).

## Lifecycle

Three separate phases — runtime mirrors boot, one module at a time:

| | Boot (all modules) | Runtime (one module) |
|---|---|---|
| register | `app.importAll(dir)` | `await app.import(spec)` |
| run hooks | `await app.init()` | `await app.link(name)` |
| tear down | — | `app.unlink(name)` |

- **`import(spec)`** loads the file, reads `name`/`needs`, and registers the module. It is the
  only call that takes a locator (path/url). It does **not** run any hooks.
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
