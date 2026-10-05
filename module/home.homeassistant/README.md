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
  A lost connection reports its entities as unavailable the same way, without `home:change`.
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

Home Assistant state strings, action IDs and input fields remain native, avoiding incomplete
hardcoded translations. No device protocols, Home Assistant automations, scenes or database tables
are duplicated in Qino. See [home](../home/) for an example flow and the provider contract.

Protocol reference: [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket/).
