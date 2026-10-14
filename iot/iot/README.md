# home

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Provider-independent connections, live observations, actions and datapoint metadata. Optional
adapters implement protocols; `sandbox.flow` owns rules and `cron` owns schedules.

## Model

- **Adapter**: a linked implementation, such as `homeassistant`, exported as `homeProvider`.
- **Provider**: a persisted connection with numeric ID, name, adapter, configuration and enabled flag.
  Multiple providers can use the same adapter. Configuration, including credentials, stays server-side.
- **Entity**: a live logical endpoint `{ id, name, state, attributes, available, updated?, unit? }`.
  An entity is not necessarily a physical device; IDs are local to a provider.
- **Value address**: every value of an entity has an address: the entity for its state, `entity/path`
  for an attribute leaf, nested objects joined by `/` (`light.kitchen/brightness`, `plug/ENERGY/Power`).
  `leaves(entity)` lists them, `at(entity, path)` reads one; lists stay one value.
- **Datapoint**: a persisted numeric ID for one value address and immutable datatype, unit and state
  mapping. An entity's unit describes its state; attribute datapoints declare their own.
  Name, expected reporting interval (seconds) and recording selection are editable.
  Latest recorded value/time are cached separately from historical observations.
- **Measurement**: datapoint ID, Unix milliseconds and typed value, or null for an unavailable observation.
  Optional `home.record` owns these tables. `home.history` queries local or upstream archives.
- **Action**: a discovered operation `{ id, name, description?, input?, targets? }`. `input` is the JSON
  schema of its data, `targets` the entity IDs it can address; without them, data is free-form and
  the action takes no targets. Writing a value is always an action; entities stay read-only.
- **Command**: a stored, named action call `{ provider, name, action, targets, data, parameter }`: to
  actions what a datapoint is to entities. `run(app, id, { data?, value? })` calls it once; `data` adds to
  or overrides the stored data, `value` fills the dotted `parameter` path, e.g. `data.command`. Values keep
  the device's units; reading the result is the job of a datapoint, not of the command.

Provider and datapoint metadata use the existing `dbschema.json` installer. No migration from ims1
or the discarded snapshot schema runs in normal module initialization.

```ts
import { save, configure, entities, call } from "@qino/qino/home";

const provider = await save(app, {
  name: "House", adapter: "homeassistant",
  config: { url: "http://homeassistant.local:8123", accessToken: "YOUR_LONG_LIVED_ACCESS_TOKEN" },
});
const datapoint = await configure(app, {
  provider, entity: "sensor.energy", name: "Energy", unit: "kWh", record: true,
});
const current = await entities(app, provider);
await call(app, provider, "light.turn_on", { entities: ["light.kitchen"], data: { brightness: 100 } });
```

SDK functions are trusted server access; `provider()` and `providers()` include credentials, `redact()`
removes schema fields marked `writeOnly`. All public API routes are superuser-only and redacted;
unlinked adapter configuration is hidden entirely. Empty secret inputs preserve saved values.
`adapter(app, name)` resolves a linked implementation, `active(app, provider)` the adapter serving an
enabled provider. Endpoints such as a URL are ordinary adapter configuration. `entities()` without a provider leaves
out providers that fail; ask one provider to see its error.

## APIs and rules

```
adapters                                       get
providers                                      get, post { name, adapter, config?, enabled? }
provider/:provider                             get, put, patch { enabled }, delete
entities                                       get { provider? }
actions                                        get { provider }
provider/:provider/entity/:entity               get
provider/:provider/action/:action               post { entities?: string[], data?: object }
datapoints                                     get { provider? }, post { provider, entity, ... }
datapoint/:datapoint                            get, put { name?, interval?, record? }
commands                                       get { provider? }, post { provider, name, action, targets?, data?, parameter? }
command/:command                                get, put { name?, action?, targets?, data?, parameter? }, delete
command/:command/run                            post { data?, value? }
```

Provider, datapoint and command route IDs are numeric. Removing providers with datapoints or commands is rejected:
disable them to preserve identity and archive access. Changing an existing datapoint's interpretation
requires a new datapoint; posting an existing interpretation reuses its datapoint. Changing a
referenced provider's adapter requires a new provider.

`home:observe` carries `{ provider, id, entity, time }` for the recorder. Reports of a source carry
`{ provider, id, entity, previous, changed }` for rules, `changed` being the paths whose values differ
(`""` for the state): `home:input` fires for every report, so each press of a button counts even when
it equals the last; `home:change` only when `changed` is not empty. `reported()` publishes all three,
`observed()` only an observation. Snapshots and lost connections enter history without reports:
a lost connection is observed as unavailable entities, a deliberate close (disable, unlink) not at all.
Creation/removal use null `previous`/`entity`.
Commands are sent once; acknowledgements do not fabricate observed state or replay failed actions.

```ts
import { listen } from "@qino/qino/sandbox.flow";

listen(app, {
  description: "Switch on a light when motion starts", owner: 7,
  on: { host: "app", event: "home:change" },
  tools: ["home_provider_action_post"],
  test: false, // Omit while testing to record writes without execution.
  code: `
    if (event.provider !== ${provider} || event.id !== "binary_sensor.kitchen_motion") return;
    if (!event.changed.includes("") || !event.entity?.available || event.entity.state !== "on") return;
    const action = { provider: ${provider}, action: "light.turn_on", entities: ["light.kitchen"] };
    await tools.home_provider_action_post(action);
    return "switched on";
  `,
}, { signal });
```

Use an existing superuser as owner and an explicit provider ID in persisted rules. Listen to `home:input`
for events such as button presses, to `home:change` for states. Filter transitions to avoid feedback loops. Device events arrive outside their initiating flow; local suppression does not
cover them. Rules require Qino to run; missed events are not replayed.

## Add an adapter

Export `homeProvider` from `plugin.ts` with a dependency on `home`:

```ts
import { observed, reported } from "@qino/qino/home";
import type { Adapter } from "@qino/qino/home";

export const homeProvider: Adapter = {
  name: "myadapter",
  entities: (app, id) => connection(app, id).entities(),
  actions: (app, id) => connection(app, id).actions(),
  call: (app, id, action, input) => connection(app, id).call(action, input),
};
// Initial state: await observed(app, provider, entity.id, entity, Date.now());
// Every report of the source: await reported(app, provider, entity.id, entity, previous);
```

An optional JSON schema describes instance configuration, including URL and write-only secrets.
Actions describe their data as JSON schema (`input`) and list the entities they address (`targets`),
translated from the protocol's own metadata, so forms and commands work the same for every adapter.
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
the separation of commands and observations. Existing flows can calculate derived values or
handle transitions; formula languages, physical counter offsets and alarm acknowledgement archives
are separate extensions. See [REVIEW.md](REVIEW.md) for storage assumptions and limitations.
