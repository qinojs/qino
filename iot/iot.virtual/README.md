# home.virtual

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

A [home](../home/) adapter whose entities are made of existing parts: a virtual entity reads its
state from a source entity of any provider and is set through a stored command. It gives devices that
do not link reading and writing themselves the shape of well-integrated ones: an entity, and an action
that targets it. Datapoints, recording, value blocks, forms and flows then work without special cases.

```ts
import { saveVirtual } from "@qino/qino/home.virtual";

await saveVirtual(app, {
  provider: virtualProvider, name: "Phone brightness",
  source_provider: 2, source_entity: "sensor.handy_screen_brightness",  // read
  command: 3,                                                            // set, through its parameter
  value: { type: "integer", minimum: 0, maximum: 255 },                  // what it is set to
});
```

- **Provider**: virtual entities belong to a provider with the adapter `virtual`; it has no configuration.
- **Reading**: the source's observations and changes are passed on as the virtual entity's. Without a
  source the entity is only set; a missing or offline source makes it unavailable.
- **Setting**: each entity has its own action `set.<id>` targeting it, with `value` as input. The value
  is validated against the entity's value schema and fills the command's parameter. A command without
  parameter is run as is.
- Sources must be real entities: a virtual source could form a cycle. Values keep the device's units.

## Templates

A template lists the pairs of source entity and command a kind of device always has. `apply()` creates
them for one device of a provider with the template's adapter; existing names are skipped.

| Template | Adapter | Device |
| --- | --- | --- |
| `android` | `homeassistant` | Home Assistant Android app; `{device}` as in `notify.mobile_app_{device}` |

The Android template covers the app's commands that take one value (brightness, volumes per stream,
ringer and do-not-disturb modes, flashlight, Bluetooth, launch app, speak …) and pairs them with their
sensors where the app has one. Commands with several related inputs (`command_media`, `command_activity`,
`command_broadcast_intent`, `command_app_lock`) stay ordinary commands. Sensors exist only when enabled
in the app. Add templates as JSON files in `templates/`.

## API

```
virtuals                     get { provider? }, post { provider, name, source_provider?, source_entity?, command?, value? }
virtual/:virtual             get, put, delete
templates                    get
template/:template/apply     post { provider, source, device }
```

All routes are superuser-only. [cms.backend.home.virtual](../cms.backend.home.virtual/) is the backend page.
