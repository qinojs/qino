# home.history

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Optional access to stored observations, inspired by `ims1` measurement histories. Storage stays
with the provider; this module does not create a measurement database or record live events.

Register `home.history` with the existing store before `app.init()`. Providers opt in through
`homeProvider.history(app, entity, { start, end })`, returning observations in the existing `Entity`
shape with `updated` as their observation timestamp. `home.homeassistant` supports this capability.

```ts
import { history, providers } from "@qino/qino/home.history";

const available = providers(app);
const samples = await history(app, "homeassistant", "sensor.temperature", {
  start: "2026-10-03T00:00:00Z", end: "2026-10-04T00:00:00Z",
});
```

API routes require a signed-in user and use the existing access checks:

```
GET /api/home.history/providers
GET /api/home.history/provider/:provider/entity/:entity?start=...&end=...
```

Flow tools are `homeHistory_providers_get` and `homeHistory_provider_entity_get`.
Both timestamps are required and include a timezone; they are normalized to UTC before dispatch.
Unknown providers, providers without history, invalid periods and upstream failures report errors.
An empty history returns an empty array. Missing samples are not replaced by zero, interpolated,
aggregated or used to change the current observation cache.

Retention, sampling and access to historical data are controlled by the provider. A provider may
return a sample representing the state at the period start. The API does not promise an exhaustive
event log, uniform intervals or historical observations for every currently available entity.

Home Assistant uses its [History REST API](https://developers.home-assistant.io/docs/api/rest/).
Its History integration must be enabled and the requested entity must have recorded data. Requests
reuse the app's credentials and proxy prefix, time out and are aborted when the adapter is unlinked.
Credentials stay server-side, and redirects are rejected. No additional settings are required.
