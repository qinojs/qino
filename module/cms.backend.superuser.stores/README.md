# cms.backend.superuser.stores

Registers module stores and installs modules from their catalogs.

A store is a `store.json` catalog; a module named `x.y` lives beside it under `x.y/plugin.ts`
(see [core/docs/stores.md](../core/docs/stores.md)). Any `file:`, `http:` or `https:` URL works.

Stores added here are kept in this module's `urls` setting. Stores declared in `server.ts` come from
the operator and are therefore not in that list and not removable — the difference in origin *is*
the difference in removability.

Two limits until the core grows a module registry:

- Installing imports and links a module at runtime; a restart resets it.
- Stores declared in `server.ts` are not listed, because `app.stores` cannot be enumerated yet.
