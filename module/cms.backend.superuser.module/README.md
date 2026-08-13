# cms.backend.superuser.module

The module administration: registers stores, installs and controls modules, and inspects their
runtime metadata and source files.

A store is a `store.json` catalog; a module named `x.y` lives beside it under `x.y/plugin.ts`
(see [core/docs/stores.md](../core/docs/stores.md)). Any `file:`, `http:` or `https:` URL works.

The overview combines the stores and every module the application knows of — from a catalog, declared in
`server.ts`, or installed and no longer importable. Filter by store and state, search by name, or
click a store to filter by it; that happens in the browser, so the list never reloads while you
narrow it down. A module name opens its detail page with exports, schemas, API routes, dependencies
and source files.

Both lists come from core and so does their persistence: a store or module the application declares
in `server.ts` has no row of its own and therefore no remove button — the difference in origin *is*
the difference in removability.

Per module the page offers what the state allows: install, then activate/deactivate (runtime only,
a restart re-links) and uninstall, which lets the module clean up and forgets it. *not importable*
means the row survived its code — a deleted folder, an unreachable host. Those are skipped at boot
instead of stopping it, and uninstall is the way to drop the row.

An action goes through the node API and answers with its own row, which replaces the old one in
place: the new buttons are the confirmation, and only a failure raises an alert. Adding or removing
a store reloads the page — its modules come and go with it.

Catalogs are read on every render, never cached — a store is always shown as it is right now. Fine
for a local file, one HTTP round trip per store and page view for a remote one.

Installing a module brings its missing dependencies along, so the button asks first and names them —
`installPlan` reads the manifests without importing anything, and a module that needs nothing shows
no dialog at all.

Registering a store is a superuser act, and this page hides those buttons for everyone else: a
module is server code, so which catalogs may supply it is not a decision that comes with page
access. Installing a module needs no extra check — it goes through `store.install(name)`, so a
request names a store and a module, never a URL to import. Nothing yet binds an installed module to
the code that was reviewed; see integrity pinning in the core document before exposing a remote
store.
