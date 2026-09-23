# cms.backend.superuser.module

Module administration: register stores, install and control modules, inspect their metadata and
source files.

A store is a `store.json` catalog; module `x.y` is at `x.y/plugin.ts` next to it (see
[core/docs/stores.md](../core/docs/stores.md)). `file:`, `http:` and `https:` URLs work.

The overview lists all stores and every known module — from a catalog, declared in `server.ts`, or
installed but no longer loadable. Filtering by store and state and searching by name happen in the
browser, without reload. A module name opens its detail page (exports, schemas, API routes,
dependencies, source files).

Both lists and their persistence come from core. Stores and modules declared in `server.ts` have no
row, and therefore no remove button.

Per module, the page offers what the state allows: install, activate/deactivate (runtime only; a
restart links again) and uninstall (the module cleans up and is forgotten). *broken* means the row
exists but the code is gone — deleted folder, unreachable host, or no store offers the name; the
row says which. Broken modules are skipped at boot; uninstall removes the row.

A module offered by two stores is listed under both; the other store's row offers *Use this
source*, which relinks it from there and updates its row. The module keeps its data; while
something depends on it, only a restart can switch.

Actions go through the node API and return the updated row, which replaces the old one — the new
buttons are the confirmation; only errors show an alert. Adding or removing a store reloads the
page.

Catalogs are read on every render, never cached: one HTTP request per remote store and page view.

Installing brings missing dependencies along, so the button first asks and names them —
`installPlan` reads the manifests without importing anything; without dependencies there is no
dialog.

Only superusers see the store buttons: a module is server code, so choosing its sources is not
part of page access. Installing needs no extra check — it uses `store.install(name)`, so a request
only names a store and a module, never a URL. Nothing yet ensures the installed code is the
reviewed one; see integrity pinning in the core docs before using a remote store.
