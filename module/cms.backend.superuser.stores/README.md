# cms.backend.superuser.stores

Registers module stores and installs modules from their catalogs.

A store is a `store.json` catalog; a module named `x.y` lives beside it under `x.y/plugin.ts`
(see [core/docs/stores.md](../core/docs/stores.md)). Any `file:`, `http:` or `https:` URL works.

Both lists come from core and so does their persistence: a store or module the application declares
in `server.ts` has no row of its own and therefore no remove button — the difference in origin *is*
the difference in removability.

Per module the page offers what the state allows: install, then activate/deactivate (runtime only,
a restart re-links) and uninstall, which lets the module clean up and forgets it.

Note that anyone who reaches this page can import code from any URL — see the deferred host
allow-list in the core document before exposing a remote store.
