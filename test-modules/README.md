# Test modules

Optional CMS modules for examples, diagnostics, and integration testing. They are deliberately
outside the standard `module/` store and consume Qino only through its public package exports.

```ts
await app.stores.add(import.meta.resolve("./test-modules/store.json")).addAll();
```

The store is not intended for production installations.
