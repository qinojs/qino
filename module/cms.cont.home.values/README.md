# cms.cont.home.values

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

A read-only CMS content block for current home observations, inspired by the PHP
`cms.cont.ims1.dashboard.live_values` module. It works with every linked `homeProvider`.

Register the module with the app's existing store before `app.init()`, then add a block:

```ts
store.add("cms.cont.home.values");
await app.init();
const block = await page.cont("values", { module: "cms.cont.home.values" });
// Optional: restrict the block to one provider and/or one provider-local entity ID.
block.settings.provider(1);
block.settings.entity("sensor.temperature");
```

With provider ID zero and an empty entity setting, the block displays every provider's entities. Values retain their
types and unavailable entities are marked explicitly. A provider failure leaves other
providers visible. Reload the page to read the latest observations; there is no polling.

Placing the block publishes its values: page access decides who sees them. No device actions, formulas, storage, unit conversion or permission exceptions
are introduced. Use `cms.backend.home` for manual actions and `sandbox.flow` for rules.
