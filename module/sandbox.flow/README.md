# sandbox.flow

When an event fires, runs a flow: a list of steps, each a description and a small function, in a
[sandbox](../sandbox/). The code sees only the tools the flow may use, and they run with the rights of
its owner. Mostly an AI writes the flow, with the same tools it used and tested while planning.

```ts
import { listen } from "@qino/qino/sandbox.flow";

listen(app, {
  description: "Deutsche Texte von mir übersetzen, wenn sie fertig aussehen",
  on: { host: "db", event: "table:update-after" },
  owner: 9,
  tools: ["post_ai1Api_decide", "get_core_languages", "post_cmsText_text_translate"],
  test: false, // tried out, now for real
  steps: [
    {
      description: "Nur deutsche Texte, die ich geändert habe",
      fn: (e, { context }) => e.table === "text_lang" && e.data.lang === "de" && context.user === 9,
    },
    {
      description: "2 Minuten nach der letzten Änderung",
      debounce: { ms: 120_000, by: "data.text_id" },
    },
    {
      description: "Nur wenn der Text fertig aussieht",
      fn: async (e, { tools }) => {
        const options = ["done", "draft"];
        const { choice } = await tools.post_ai1Api_decide({ content: e.data.text, question: "Fertig?", options });
        return choice === "done";
      },
    },
    {
      description: "In alle anderen Sprachen übersetzen",
      fn: async (e, { tools }) => {
        const { all } = await tools.get_core_languages();
        for (const lang of all.filter((l) => l !== "de")) {
          await tools.post_cmsText_text_translate({ text: e.data.text_id, targetLang: lang, sourceLang: "de" });
        }
        return true;
      },
    },
  ],
}, { signal, report: (trace) => console.log(trace) });
```

- **Steps:** each gets the previous result (the first one the event) and `{ tools, context }`; a falsy
  result stops the run, `true` passes the input on (a filter is just its condition). `fn` is a function
  or its source — self-contained, it sees nothing else.
- **The event** arrives as data: objects of a class become their string form (a `DbTable` its name).
- **`context.user`:** who caused the event, taken as it fires; **`owner`**: the flow's owner, so "when I …"
  is `context.user === owner`.
- **`tools`:** the api's tools (`toTools`), only those named in `tools`, one params object each.
  They run in one request context per run, as `owner` (actor `sandbox.flow`), made by the first call.
- **One sandbox per listening flow**, shared by its runs: no worker start per event. Tool calls carry
  their run, so traces stay apart. A timeout in one run ends the worker and the flow's other runs.
- **`debounce`:** a step that waits `ms`; if a later run of the flow reaches it with the same key
  (`by`, a path into the value) meanwhile, this run ends as `superseded`.
- **`test`** is on unless `false`: only `get_*` tools take effect, the others are recorded as `skipped`
  and return `undefined`. So a step returns a value of its own, not a writing tool's result — else it
  stops in a test that would go on for real.
- **The trace** (`run()` returns it, `listen()` hands it to `report`): per step its result, error and
  tool calls; `end` is `done`, `stopped`, `superseded` or `error`.
- **Own events are ignored:** the run's request context is marked from the start (`runAs` with
  `state`), so the flow skips every event of the run — those of setting the context up included.

`run(app, flow, event, context)` runs a flow once, e.g. to test it on an example event.

## The table

Flows kept as data (table `flow`: `host`, `event`, owner `usr_id`, `tools` and `steps` as JSON with each
`fn` as source) are listened to on start when `active`; a changed row is listened to anew, a deleted
one stops. `test` is on unless set off. A row that can't listen (unknown host, broken JSON) is logged
and skipped; failing runs are logged too.

## Api

```
flows              get · post     your flows · make one, owned by you
flows/:flow        get · patch · delete
flows/:flow/test   post { event, user? }   try it on an example event, always as a test run → the trace
```

A flow belongs to who made it: to anyone else it answers like a missing one. Its tools run with the
owner's rights, so a flow never does more than its owner could.

## Planner

An agent that turns a sentence into a flow — no code of its own: in **cms.backend.ai1.chat** make an
agent with the tools `sandbox.flow` and [ai1.discover](../ai1.discover/) and this role, then tell it
what should happen.

```
You make flows for qino: when an event fires, steps of JavaScript run with the tools the flow may use.
The user says in a sentence what should happen; you build the flow, test it, show the result, and
switch it on only when the user says so.

How to work:
1. Find the event: get_ai1Discover_events({ search: "a text was changed" }), then its data:
   get_ai1Discover_events_event({ event: "db:table:update-after" }). Events are named host:event.
   Table events carry { table, id, data }: id is the primary key as text (a composite one joined
   by ":", text_lang "12:de"), data the columns written. Time: app:cron:hour and app:cron:day carry
   { time, date, weekday, hour }.
2. Find what the steps need: get_ai1Discover_tables / get_ai1Discover_tables_table for columns,
   get_ai1Discover_tools / get_ai1Discover_tools_tool for a tool's parameters.
3. Make it: post_sandboxFlow_flows (inactive and in test mode until you change that).
4. Test it on an example event built from the event's data: post_sandboxFlow_flows_test. Show the
   user the trace; fix with patch_sandboxFlow_flows.
5. Only when the user says so: patch_sandboxFlow_flows({ flow, active: true, test: false }).
6. If an event or a tool is missing, say so. Never work around it.

The steps:
- A step is { description, fn } with fn as JavaScript source: (value, { tools, context, owner }) => …
  value is the previous step's result, for the first step the event's data.
- Return false or null to stop, true to pass value on unchanged, anything else is the next value.
  So a filter is just its condition.
- tools.<name>(params) calls a tool: only those listed in the flow's tools, one params object with
  path params by name, always await. context.user is who caused the event, owner is you (the
  flow's owner): "when I …" is context.user === owner.
- { description, debounce: { ms, by } } waits; of runs with the same key (by: a path into value)
  only the latest goes on.
- Code sees nothing but its arguments. Keep steps small and safe to run twice.
- In test mode only get_* tools run; the others are recorded and return undefined. So a step
  returns a value of its own, never a writing tool's result.
- Judging text: post_ai1Api_decide({ content, question }) answers a yes/no question
  (.probabilities.yes); with options ["a", "b"] it picks one (.choice). In test mode it is skipped
  too: test such a step with the user, then switch test mode off.
- Descriptions short, in the user's language.

Example 1. The user: "Wenn ein deutscher Text geändert wird, übersetze ihn in alle Sprachen."

post_sandboxFlow_flows({
  "description": "Deutsche Texte übersetzen",
  "host": "db",
  "event": "table:update-after",
  "tools": ["get_core_languages", "post_cmsText_text_translate"],
  "steps": [
    {
      "description": "Nur deutsche Texte",
      "fn": "(e) => e.table === 'text_lang' && e.data.lang === 'de'"
    },
    {
      "description": "In alle anderen Sprachen übersetzen",
      "fn": "async (e, { tools }) => { const { all } = await tools.get_core_languages(); for (const lang of all.filter((l) => l !== 'de')) await tools.post_cmsText_text_translate({ text: e.data.text_id, targetLang: lang, sourceLang: 'de' }); return true; }"
    }
  ]
})
→ { "id": 4 }

post_sandboxFlow_flows_test({
  "flow": 4,
  "event": { "table": "text_lang", "id": "12:de", "data": { "text_id": 12, "lang": "de", "text": "Willkommen auf unserer Seite." } }
})
→ the trace: per step its result and tool calls; post_* calls are "skipped" in the test.

Example 2. The user: "Jeden Montag um 7 Uhr die Seite 5 in alle Sprachen übersetzen, was noch fehlt."

post_sandboxFlow_flows({
  "description": "Montags Seite 5 übersetzen",
  "host": "app",
  "event": "cron:hour",
  "tools": ["post_cmsText_page_translateAllLangs"],
  "steps": [
    { "description": "Montags um 7", "fn": "(e) => e.weekday === 'monday' && e.hour === 7" },
    {
      "description": "Fehlende Übersetzungen ergänzen",
      "fn": "async (e, { tools }) => { await tools.post_cmsText_page_translateAllLangs({ page: 5, ifNeeded: true }); return true; }"
    }
  ]
})
```

## Not yet

- **Test mode goes by name, not by effect:** only `get_*` tools run, so a `POST` that changes nothing
  (`post_ai1Api_decide`) is skipped too and returns `undefined`. Plan: a route says it only reads
  (`Verb.readOnly`, `GET` by default), `toTools` passes it on as MCP's `annotations.readOnlyHint`, and a
  test run skips what is not read-only. Core vocabulary, needs an OK.
- **Events are not filtered by rights:** a flow sees every event of its host, whatever its owner may
  read — a flow on `table:insert-after` sees every row of every table. Its api is for superusers until then.
  Plan: a flow sees what its owner caused; events of others only where the event declares who may
  listen (like `access`/`guard` of an api route, e.g. `node:*` for who may read the node).
- **Runs live in memory:** a crash or restart loses a running run and a debounce wait (at-most-once).
  Later, per flow: store the event before the run, delete it after, rerun what is left on start
  (at-least-once, steps idempotent).
- **Runs are kept in memory only:** `history(app, id)` has the latest 20 of a flow of the table, newest
  first; runs that stopped at the first step (the event was not for it) are only counted. A restart
  forgets them; what a run changed is in the core log (actor `sandbox.flow`).
