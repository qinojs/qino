# home

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Provider-independent discovery, observations and actions. No CMS dependency, device-type registry,
database mirror or automation engine: use `sandbox.flow` for rules and `cron` for schedules.

For manual inspection and control in the CMS, install the optional [cms.backend.home](../cms.backend.home/).
For read-only values on a CMS page, use [cms.cont.home.values](../cms.cont.home.values/).
For stored observations, use the optional [home.history](../home.history/) capability.

An **entity** is a logical endpoint, not necessarily a physical device. A device may expose several
entities. Every entity has `{ id, name, state, attributes, available, updated? }`. States and
attributes retain their types. Reads return observations, never desired states.

An **action** has `{ id, name, description?, fields? }`. Its fields are provider-defined discovery
metadata. The common API does not invent a fixed vocabulary of device types, actions or units.
Provider and entity/action ID are separate: the same ID may exist in multiple providers.

```ts
import { actions, call, entities } from "@qino/qino/home";

const endpoints = await entities(app); // every linked provider, with `provider` on each entry
const available = await actions(app, "homeassistant");
await call(app, "homeassistant", "light.turn_on", {
  entities: ["light.kitchen"],
  data: { brightness: 100 },
});
```

## API and flows

All routes require a signed-in user and use the existing API access checks. There is no separate
permission model in this module. A flow calls them with its owner's rights and its allowed tools.

```
providers                                      get
entities                                       get { provider? }
actions                                        get { provider? }
provider/:provider/entity/:entity               get
provider/:provider/action/:action               post { entities?: string[], data?: object }
```

`GET /api/home/entities` lists all observations. A disconnected provider reports an error rather
than presenting stale values as live. Action calls acknowledge execution; actual device state is
observed separately. Failed/interrupted commands are never automatically replayed.

Changes fire **`app:home:change`** with `{ provider, id, entity, previous }`: `previous` is `null` on
creation, `entity` is `null` on removal. Initial snapshots do not generate synthetic changes.

```ts
import { listen } from "@qino/qino/sandbox.flow";

listen(app, {
  description: "Switch on the kitchen light when motion is detected",
  on: { host: "app", event: "home:change" },
  owner: 7, // an existing user of this app
  tools: ["home_provider_action_post"],
  test: false, // omit while testing: writes are then recorded without execution
  steps: [
    {
      description: "Only a new motion detection",
      fn: (e) => e.provider === "homeassistant" && e.id === "binary_sensor.kitchen_motion"
        && e.entity?.available && e.entity.state === "on" && e.previous?.state !== "on",
    },
    {
      description: "Switch on the light",
      fn: async (_e, { tools }) => {
        await tools.home_provider_action_post({
          provider: "homeassistant", action: "light.turn_on", entities: ["light.kitchen"],
        });
        return true;
      },
    },
  ],
}, { signal }); // the owning module's init signal
```

Provider-specific IDs and fields remain provider-specific: replacing a provider may require changing
those parameters in a rule, but does not require replacing the flow engine or the common API.
Filter genuine transitions to avoid feedback loops. External device events arrive outside the
original flow context, so the flow engine's suppression of its own local events does not cover them.
Rules in Qino require Qino to run; missed events during downtime are not replayed.

## Add a provider

Export `homeProvider` from a module's `plugin.ts`, with a dependency on `home`:

```ts
import { changed } from "@qino/qino/home";
import type { Provider } from "@qino/qino/home";

export const homeProvider: Provider = {
  name: "myprovider",
  entities: (app) => connection(app).entities(),
  actions: (app) => connection(app).actions(),
  call: (app, action, input) => connection(app).call(action, input),
};

// In the provider's observation listener, after updating its own state:
await changed(app, "myprovider", id, entity, previous);
```

This is the same plugin-export convention used by other Qino providers. Names must be unique within
an app. Keep each connection and its state on the app; use `init(app, { signal })` to stop sockets,
timers and listeners on unlink. An action's `entities` are local IDs; `data` contains its input fields.
Do not report successful action calls as observed state changes.

## Lessons from ims1

The read-only PHP reference is `/var/www/workplace/v9/m/`. These parts informed the design:

| PHP source | Idea used in Qino |
| --- | --- |
| `ims1/lib/ims1_datapoint.class.php` | Keep a current observation separate from historical samples. Missing readings are not zero. |
| `ims1.push1/qg.php` | Sending a command and observing its result are separate steps. |
| `cms.cont.ims1.dashboard.live_values/index.php` | Show current values in an optional, small CMS block. |
| `ims1.virtual1/qg.php` | Derived values are useful; calculations can use existing flow steps without adding another expression language. |
| `cms.cont.ims1.alarm1/qg.php` | React to transitions, rather than repeatedly notifying for the same state. |

The PHP measurement tables, formula parser and alarm archive are not migrated by these modules.
An acknowledged command does not confirm an observed state. Likewise, acknowledging an alarm must
not silently clear the underlying condition. Flows can distinguish creation, changes, disappearance
and unavailable entities using `entity` and `previous`; they should choose their handling explicitly.

Derived entities and an alarm acknowledgement/archive UI remain separate extensions. The current
modules do not assume a numeric state, a device taxonomy or a fixed alarm vocabulary. `home.history`
reads provider-specific histories without requiring a Qino measurement database.

## Optional local recording and charts

`home.record` owns the optional measurement database (`dbschema.json`), selected entity capture and
periodic availability samples. `home.history` accesses local or upstream archives through the same
API. `cms.cont.home.chart` renders numeric measurements or cumulative-counter consumption with a
real time axis and visible gaps. These capabilities do not require Home Assistant. Providers may
supply optional `Entity.unit`; Home Assistant maps its native unit attribute to that field.
