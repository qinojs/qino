# cms.cont.home.command

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

A CMS content block that runs one stored [home](../home/) command: a button, or a value field when the
command has a parameter. It works with every linked `homeProvider`; reading a state is the job of
`cms.cont.home.values` or `cms.cont.home.chart`.

```ts
store.add("cms.cont.home.command");
const block = await page.cont("brightness", { module: "cms.cont.home.command" });
block.settings.command(3);   // stored command ID
block.settings.min(0);       // with max: a slider, and the server rejects values outside
block.settings.max(255);
```

Placing the block publishes its command: page access decides who can run it. The block runs only its
configured command; visitors can set the value of its parameter, never other data, targets or actions.
Values keep the device's units. A run is acknowledged, not observed: the device's state shows the result.
