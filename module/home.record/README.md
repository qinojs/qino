# home.record

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Optional provider-independent local recording, inspired by ims1's separation of measurement
series and observations. Register `home.record` through the store before `app.init()`; its
`dbschema.json` creates `home_series` and `home_sample` using the existing schema installer.
Dependencies are `home.history` and `cron`. Nothing is recorded until an entity is selected.

The Home automation backend shows a **Record** checkbox when this module is linked. Flows and
other server code can use the same user-protected API, or the module SDK:

```ts
import { configure } from "@qino/qino/home.record";
await configure(app, "homeassistant", "sensor.energy", true);
await configure(app, "homeassistant", "sensor.energy", false); // Keep existing history.
```

```
GET  /api/home.record/series
POST /api/home.record/provider/:provider/entity/:entity  { "enabled": true }
```

Tools: `homeRecord_series_get`, `homeRecord_provider_entity_post`. API routes require a signed-in
user; SDK calls are trusted server code. Select individual series, not every discovered entity.
A series identity consists of provider name and provider-local entity ID; neither is a display name.

Selected observations are captured on `home:change` and periodically by the existing cron scheduler
(default every 60 seconds). Selecting a series immediately captures its current state. A missing
entity, disconnected provider or removed entity produces an unavailable sample, never a synthetic
zero. Periodic samples describe Qino's current observation, not a fresh device measurement. A
provider must report availability accurately; this recorder cannot detect a stale device itself.
Recording errors are logged without stopping other change listeners.

`home_series` stores the selection and enabled flag. `home_sample` stores Unix milliseconds and the
complete JSON-compatible entity with its value types, including attributes, unit and original provider timestamp. The
composite primary key is `(provider, entity, time)`; the latest observation at the same millisecond
replaces the earlier one. Capture time belongs to Qino; local history exposes it as `updated`, while
the stored JSON preserves the source's original `updated`. Numeric conversion belongs to charts,
so booleans, text and structured states remain intact in storage.

`home.history` prefers a configured local series, including empty or stopped recordings. Explicit
`source: "provider"` requests upstream history instead; sources are never silently merged. Local
archives and their provider names remain readable when the provider is unlinked. Periods are
half-open `[start, end)` and raw-query limits report overflow rather than truncating.

There is no automatic retention, historical backfill, aggregation or import of old ims1 tables.
Storage grows while recording is enabled. This is a new schema, not an ims1 database migration.
Stopping a selection preserves its observations. `cms.cont.home.chart` provides measurement and
counter consumption views without changing those observations.
