# IoT ideas

Takeaways from “The Best Home Assistant Automations of 2026 (10 Years In)”.
Open ideas for discussion, not implementation decisions.

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
