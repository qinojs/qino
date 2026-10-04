# cms.backend.home

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Optional CMS backend for [home](../home/). Install it beside `home` and any home providers; its
installer creates a Home automation backend page. It does not depend on Home Assistant.

In an app that already registers `cms.backend` and `home`, add it before `app.init()`:

```ts
store.add("cms.backend.home");
```

Each provider gets its own observations and discovered actions. A failed provider does not hide
working providers. Entity states keep their types and are shown with availability, update time
and expandable attributes. Refresh reads current observations; no polling or history is added.

Linked providers with a settings schema get a configuration form on this page, built with the
existing schema input renderer. For Home Assistant, enter its URL and access token directly here.
Saving validates the submitted fields, stores them in the provider's own settings and relinks the
provider to apply them. It starts connecting; it does not claim the remote service is reachable.
If the provider rejects the configuration during initialization, the previous settings are restored
and the provider is linked again with those settings.
Secret fields (`writeOnly`) stay empty in the HTML; leaving them empty preserves saved values.
Unknown and read-only fields are rejected. A provider required by another linked module cannot
be relinked here until that dependency is unlinked.

To execute an action, select it, optionally choose target entities, and enter its input as a JSON
object. The expandable field metadata comes from the provider. No action or target is guessed from
a device type. Actions that require no explicit targets can be called without selecting entities.
The dialog shows the acknowledgement or error and any returned data. An acknowledgement does not
mean the device already reached the desired state.

Commands go through the same `home` API as flows, including its user access checks and input
validation. The CMS also applies its normal node access checks. Connections and their settings
belong to the providers. The panel adds no separate permission model, device protocols, database
tables or rule engine.

Rules remain in [sandbox.flow](../sandbox.flow/); schedules remain in [cron](../cron/).

When `home.record` is linked, entity rows include a **Record** checkbox. Changes use the real
user-protected recording API, and stopped recordings retain their observations. Install
`cms.cont.home.chart` for measurement and counter consumption content nodes.
The separate local-recordings table also lets you stop or resume selections whose provider or
entity is currently missing; it is a sibling card, not nested inside a provider card.
