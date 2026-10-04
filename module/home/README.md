# home

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Provider-independent connections, live observations, actions and datapoint metadata. Optional
adapters implement protocols; `sandbox.flow` owns rules and `cron` owns schedules.

## Model

- **Adapter**: a linked implementation, such as `homeassistant`, exported as `homeProvider`.
- **Provider**: a persisted connection with numeric ID, name, adapter, URL, configuration and enabled flag.
  Multiple providers can use the same adapter. Configuration, including credentials, stays server-side.
- **Entity**: a live logical endpoint `{ id, name, state, attributes, available, updated?, unit? }`.
  An entity is not necessarily a physical device; IDs are local to a provider.
- **Datapoint**: a persisted numeric ID for one provider/entity and immutable datatype, unit and state
  mapping. Name, expected reporting interval (seconds) and recording selection are editable.
  Latest recorded value/time are cached separately from historical observations.
- **Measurement**: datapoint ID, Unix milliseconds and typed value, or null for an unavailable observation.
  Optional `home.record` owns these tables. `home.history` queries local or upstream archives.

Provider and datapoint metadata use the existing `dbschema.json` installer. No migration from ims1
or the discarded snapshot schema runs in normal module initialization.

```ts
import { save, configure, entities, call } from "@qino/qino/home";

const provider = await save(app, {
  name: "House", adapter: "homeassistant", url: "http://homeassistant.local:8123",
  config: { accessToken: "YOUR_LONG_LIVED_ACCESS_TOKEN" },
});
const datapoint = await configure(app, {
  provider, entity: "sensor.energy", name: "Energy", unit: "kWh", record: true,
});
const current = await entities(app, provider);
await call(app, provider, "light.turn_on", { entities: ["light.kitchen"], data: { brightness: 100 } });
```

SDK functions are trusted server access; `provider()` and `providers()` include credentials. All
public API routes require a signed-in user and redact schema fields marked `writeOnly`. Unlinked
adapter configuration is entirely hidden by the public API. Empty secret inputs preserve saved values.

## APIs and rules

```
adapters                                       get
providers                                      get, post { name, adapter, url, config?, enabled? }
provider/:provider                             get, put, patch { enabled }, delete
entities                                       get { provider? }
actions                                        get { provider }
provider/:provider/entity/:entity               get
provider/:provider/action/:action               post { entities?: string[], data?: object }
datapoints                                     get { provider? }, post { provider, entity, ... }
datapoint/:datapoint                            get, put { provider, entity, ... }
```

Provider and datapoint route IDs are numeric. Removing providers with datapoints is rejected:
disable them to preserve identity and archive access. Changing an existing datapoint's interpretation
requires a new datapoint; changing a referenced provider's adapter requires a new provider.

`home:observe` carries `{ provider, id, entity, time }` for the recorder. `home:change` carries
`{ provider, id, entity, previous }` for rules. `changed()` publishes both; `observed()` publishes
only an observation. Initial/reconnection snapshots enter history without synthetic change rules.
Creation/removal use null `previous`/`entity`. A disconnected adapter can report unavailable entities.
Commands are sent once; acknowledgements do not fabricate observed state or replay failed actions.

```ts
import { listen } from "@qino/qino/sandbox.flow";

listen(app, {
  description: "Switch on a light when motion starts", owner: 7,
  on: { host: "app", event: "home:change" },
  tools: ["home_provider_action_post"],
  test: false, // Omit while testing to record writes without execution.
  steps: [
    { fn: (e) => e.provider === provider && e.id === "binary_sensor.kitchen_motion"
      && e.entity?.available && e.entity.state === "on" && e.previous?.state !== "on" },
    { fn: async (_e, { tools }) => {
      await tools.home_provider_action_post({ provider, action: "light.turn_on", entities: ["light.kitchen"] });
      return true;
    } },
  ],
}, { signal });
```

Use an existing owner and explicit provider ID in persisted rules. Filter transitions to avoid
feedback loops. Device events arrive outside their initiating flow; local suppression does not
cover them. Rules require Qino to run; missed events are not replayed.

## Add an adapter

Export `homeProvider` from `plugin.ts` with a dependency on `home`:

```ts
import { changed, observed } from "@qino/qino/home";
import type { Adapter } from "@qino/qino/home";

export const homeProvider: Adapter = {
  name: "myadapter",
  entities: (app, id) => connection(app, id).entities(),
  actions: (app, id) => connection(app, id).actions(),
  call: (app, id, action, input) => connection(app, id).call(action, input),
};
// Initial state: await observed(app, provider, entity.id, entity, Date.now());
// Actual change: await changed(app, provider, entity.id, entity, previous);
```

An optional JSON schema describes instance configuration, including URL and write-only secrets.
Adapter names must be unique within an App. Connections belong to the App, keyed by provider ID;
stop sockets/timers/listeners through the module's init signal. Observe `home:provider` to apply
connection changes, including enable/disable. Keep device-specific actions, units and discovery
metadata in the adapter; the common API has no fixed device taxonomy.

## Modules and ims1

Install `home.manual` for values entered without external software.
Install `cms.backend.home` for instance/datapoint configuration, measurement entry and manual actions;
`cms.cont.home.values` for current values; `home.record` for selected local recording;
`cms.cont.home.chart` for measurements and counter consumption. Dependencies install through
Qino's store; Home Assistant is optional.

The read-only reference `/var/www/workplace/v9/m/ims1` informed the numeric datapoint IDs, separate
number/state tables, current-value cache, expected intervals and null gaps. `ims1.push1` informed
the separation of commands and observations. Existing flow steps can calculate derived values or
handle transitions; formula languages, physical counter offsets and alarm acknowledgement archives
are separate extensions. See [REVIEW.md](REVIEW.md) for storage assumptions and limitations.
