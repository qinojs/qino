# home.homeassistant

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

The first provider for [home](../home/). Home Assistant owns device integrations; Qino owns the flows
you choose to run in Qino. The provider has no CMS dependency and uses the Web-standard `WebSocket`.

## Setup

Register both modules with the app's existing store, before `app.init()`:

```ts
store.add("home");
store.add("home.homeassistant");
await app.init();
```

With `cms.backend.home` installed, its Home Assistant card lets you enter the URL and access token
directly. Save and reconnect applies them without restarting Qino. Stored tokens are not read back
into the form; an empty token field keeps the saved token.

Connections are persisted provider instances, with any number of instances per App:

```ts
import { save } from "@qino/qino/home";
await save(app, {
  name: "House", adapter: "homeassistant",
  config: { url: "http://homeassistant.local:8123", accessToken: "YOUR_LONG_LIVED_ACCESS_TOKEN" },
});
```

Obtain a long-lived access token from your Home Assistant profile. The public home API redacts it;
action permissions are those of its Home Assistant account. Updating a provider reconnects only
that connection. Disabling closes it; module unlink closes all its connections. Missing credentials
leave the instance dormant. Unreachable Home Assistant does not prevent Qino from starting.
Rejected credentials stop automatic retries until configuration is corrected.

The URL may include a reverse proxy prefix. HTTP/HTTPS and WS/WSS URLs are accepted; the adapter
connects to `<base>/api/websocket`. Allow the Home Assistant host in Deno's network permissions.

## Behaviour

- Authenticates, subscribes to `state_changed`, then loads states. Changes during
  loading are buffered; initial snapshots enter history via `home:observe` without synthetic change rules.
  A lost connection reports its entities as unavailable the same way, without `home:input`/`home:change`.
- Maps Home Assistant entities to logical home entities. Native state strings and attributes are
  preserved; `unknown` and `unavailable` are reported with `available: false`.
- Discovers actions via `get_services`, including their native field metadata. Action IDs are
  `<domain>.<service>`. Discovery and calls refresh the service list so new integrations are visible.
- Executes via `call_service`, with `data` as `service_data` and explicit entities as `target.entity_id`.
  Omitting targets allows global actions, scripts and scenes; an explicitly empty target list is
  rejected. Native service-response data is requested when supported.
- Reconnects with bounded backoff, resubscribes and reloads observations. A heartbeat detects dead
  connections. Authentication and commands have timeouts; pending calls fail on disconnect. A
  timeout can mean an unknown action outcome, so the adapter never retries commands.
- Each app owns its connection. Unlink closes it, rejects pending commands and clears timers.
- Implements the optional [home.history](../home.history/) capability through the History REST API,
  retaining native states and attributes without updating current observations. The History
  integration and recorded data are required; retention remains a Home Assistant responsibility.

Home Assistant state strings and action IDs remain native, avoiding incomplete hardcoded translations.
Service field selectors become the action's JSON schema (plain values; others stay free-form JSON),
and a service's target domains select its `targets` from the current entities. No device protocols, Home Assistant automations, scenes or database tables
are duplicated in Qino. See [home](../home/) for an example flow and the provider contract.

## Troubleshooting

**Bluetooth events missing (BTHome buttons, e.g. a Puck.js).** If Home Assistant hears a Bluetooth device
only about every 10 s and presses get lost, check the host adapter before Qino: some built-in adapters
(seen with Realtek `0bda:c123`, a combined Wi-Fi/Bluetooth chip) filter duplicates per device and report
each device once per Linux LE scan cycle of 10.24 s. Measured: of presses every 6 s, 5–7 of 10 arrived, in a
~10.5 s rhythm; varying the advertisement content did not help. Qino recorded every event Home Assistant
reported. Fix: an ESPHome Bluetooth proxy (ESP32) or a USB dongle recommended by Home Assistant. Workaround
on the device: keep advertising an event for longer than a scan cycle (12 s); presses closer together then
merge into the last one.

Protocol reference: [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket/).
