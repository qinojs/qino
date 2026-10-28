# IoT ideas

Open ideas for discussion, not implementation decisions. The automation sections are takeaways
from “The Best Home Assistant Automations of 2026 (10 Years In)”.

## Reliability before more automations

- Make failures visible: unreachable providers, missing entities, and stored commands whose
  actions or targets no longer exist. Start with the existing IoT backend and discovery APIs.
- Monitor missing reports as well as alarming values. An unchanged value does not prove that a
  sensor is alive or dead; freshness needs actual reports and a known expected interval.
  `iot.record` already writes gaps for recorded datapoints after twice their expected interval,
  but this is not a complete health report and does not cover unrecorded sensors.
- Catch failures of independent actions so one offline device does not stop an entire routine.
  Keep errors visible in the flow result; do not continue steps that depend on a failed action.
- Do not blindly retry device commands: a timeout can leave their outcome unknown.

## Automations people can live with

- Physical controls should remain usable when Qino is unavailable. Direct device operation
  belongs to the device setup; a server-side flow cannot guarantee it.
- Manual choices should take precedence: avoid overwriting an already selected light level,
  allow temporary automation suspension, and give a warning before switching occupied rooms off.
  Current generic IoT events do not reliably distinguish human actions from automation actions.
- Add context to simple rules before adding complexity: media playback, presence, time of day,
  and an explicit guest mode can prevent disruptive actions.
- Only undo what an automation still owns. A later manual choice must not be reverted by an
  earlier automation's cleanup.

## Time and notifications

- Store deadlines rather than relying only on running timers. Guest modes, manual overrides,
  cooldowns, and delayed actions should be re-evaluated after a restart. Existing persisted
  flow state can hold timestamps, but needs a suitable recurring trigger to evaluate them.
- Give temporary modes an expiry so forgotten settings do not disable normal behavior forever.
- Group related notifications, suppress repeats, and offer acknowledgement or snooze where
  the notification channel supports it. Remember pending reminders when nobody is home.
- Surface important conditions where people are: a shared status display or light can be more
  useful than another private phone notification. Keep meanings few and understandable.

## Add complexity only for a concrete need

- Improve presence detection when simple motion rules fail in practice. Combine correlated
  sensors before treating them as independent evidence; define behavior for unavailable inputs.
- Start AI with optional text rewriting and a deterministic fallback. If AI later controls a
  decision, choose the fallback per use case rather than applying one universal default.
- Keep rules in `sandbox.flow`, schedules in `cron`, and protocol details in adapters.
  Prefer existing mechanisms; discuss any new schema vocabulary or core API before adding it.

## Data model

### Topics: a logical address

In ims1 the reporters were built for ims1 and reported `topic → value`, so a topic was the technical
and the logical address at once (`ims1_datapoint.topic`, unique). Here the provider dictates the
technical address (`event.puck_ce76_taste/event_type`). The datapoint is the link: it could get a
unique logical `topic` (e.g. `house/ground/kitchen/light`) beside its source. The topic tree with
titles and page mapping (`ims1_topic`, `ims1_topic_page`) would be a separate module on top, once
several flats or buildings need it.

### Devices: a physical identity across providers

Qino sees entities, not the devices behind them. Home Assistant's device registry has `identifiers`
and `connections`, physical addresses such as `("bluetooth", "F3:6A:EA:74:CE:76")` or a Zigbee IEEE
address, sometimes `serial_number`, `manufacturer`, `model`. An adapter could add an optional device
with such connections to its entities. Qino could then recognise the same device arriving through
another provider (Home Assistant today, MQTT or direct Bluetooth later) and let a datapoint follow
its device, group the backend by device, detect replaced counters by serial number (as
`ims1_real_counter.serial_nr`), propose templates by model, and show battery and last seen per
device. Limits: phones randomise their Bluetooth address (only the app ID is stable, until a
reinstall), many providers know no physical address, and one device may have several.

### Stable entity references

Datapoints and commands keep the provider's entity ID. Renaming an entity in Home Assistant while
Qino references it breaks the reference; Home Assistant's immutable `unique_id` would survive
renames.

### Flows depend on the provider's shape

A flow on a Home Assistant button reads `e.entity.attributes.event_type`: it only works because Home
Assistant represents events that way. This is possibly unpleasant: the owner wants no exceptions, no
assumptions about a provider and no inconsistencies. A direction: an event per datapoint value (e.g.
`iot:value { datapoint, value, time }`), so flows use the datapoint's translated values and stay
unchanged when a device moves to another provider. Cost: every value a flow reacts to needs a
datapoint first. Revisit with a second device provider.
