# sandbox.flow

When an event fires, runs a flow: a function body in a [sandbox](../sandbox/), like the code of an
`onclick` attribute. The code sees only the tools the flow may use, and they run with the rights of its
owner. Mostly an AI writes the flow, with the same tools it used and tested while planning.

```ts
import { listen } from "@qino/qino/sandbox.flow";

listen(app, {
  description: "Deutsche Texte von mir übersetzen, wenn sie fertig aussehen",
  on: { host: "db", event: "table:update-after" },
  owner: 9,
  tools: ["ai1Api_decide_post", "core_languages_get", "cmsText_text_translate_post"],
  test: false, // tried out, now for real
  code: `
    if (event.table !== "text_lang" || event.data.lang !== "de" || context.user !== owner) return;
    const options = ["done", "draft"];
    const { choice } = await tools.ai1Api_decide_post({ content: event.data.text, question: "Fertig?", options });
    if (choice !== "done") return;
    const { all } = await tools.core_languages_get();
    for (const lang of all.filter((l) => l !== "de")) {
      await tools.cmsText_text_translate_post({ text: event.data.text_id, targetLang: lang, sourceLang: "de" });
    }
    return "translated";
  `,
}, { signal, report: (trace) => console.log(trace) });
```

- **`code`** is a function body, run as `async (event, tools, context, owner) => { code }`. It sees
  nothing else; `return` ends the run, its value goes into the trace.
- **`event`** arrives as data: objects of a class become their string form (a `DbTable` its name).
- **`context.user`:** who caused the event, taken as it fires; **`owner`**: the flow's owner, so "when I …"
  is `context.user === owner`.
- **`tools`:** the api's tools (`toTools`), only those named in `tools`, one params object each.
  They run in one request context per run, as `owner` (actor `sandbox.flow`), made by the first call.
- **One sandbox per listening flow**, shared by its runs: no worker start per event. Tool calls carry
  their run, so traces stay apart. A timeout in one run ends the worker and the flow's other runs.
- **`test`** is on unless `false`: only `*_get` tools take effect, the others are recorded as `skipped`
  and return `undefined`.
- **The trace** (`run()` returns it, `listen()` hands it to `report`): the tool calls, the result or the
  error; `end` is `done` or `error`.
- **Own events are ignored:** the run's request context is marked from the start (`runAs` with
  `state`), so the flow skips every event of the run — those of setting the context up included.

`run(app, flow, event, context)` runs a flow once, e.g. to test it on an example event.

## The table

Flows kept as data (table `flow`: `host`, `event`, owner `usr_id`, `code`, `tools` as JSON)
are listened to on start when `active`; a changed row is listened to anew, a deleted one stops. `test` is
on unless set off. A row that can't listen (unknown host, broken JSON) is logged and skipped; failing runs
are logged too.

## Api

```
flows              get · post     your flows · make one, owned by you
flow/:flow         get · patch · delete
flow/:flow/test    post { event, user? }   try it on an example event, always as a test run → the trace
```

A flow belongs to who made it: to anyone else it answers like a missing one. Its tools run with the
owner's rights, so a flow never does more than its owner could.

## Planner

An agent that turns a sentence into a flow — no code of its own: in **cms.backend.ai1.chat** make an
agent with the tools `sandbox.flow` and [ai1.discover](../ai1.discover/) and this role, then tell it
what should happen.

```
You make flows for qino: when an event fires, a JavaScript function body runs with the tools the flow
may use.
The user says in a sentence what should happen; you build the flow, test it, show the result, and
switch it on only when the user says so.

How to work:
1. Find the event: ai1Discover_events_get({ search: "a text was changed" }), then its data:
   ai1Discover_event_get({ event: "db:table:update-after" }). Events are named host:event.
   Table events carry { table, id, data }: id is the primary key as text (a composite one joined
   by ":", text_lang "12:de"), data the columns written. Time: app:cron:hour and app:cron:day carry
   { time, date, weekday, hour }.
2. Find what the code needs: ai1Discover_tables_get / ai1Discover_table_get for columns,
   ai1Discover_tools_get / ai1Discover_tool_get for a tool's parameters.
3. Make it: sandboxFlow_flows_post (inactive and in test mode until you change that).
4. Test it on an example event built from the event's data: sandboxFlow_flow_test_post. Show the
   user the trace; fix with sandboxFlow_flow_patch.
5. Only when the user says so: sandboxFlow_flow_patch({ flow, active: true, test: false }).
6. If an event or a tool is missing, say so. Never work around it.

The code:
- code is the body of async (event, tools, context, owner) => { … }. return ends the run; what it
  returns shows in the trace. Return early when the event is not for the flow.
- tools.<name>(params) calls a tool: only those listed in the flow's tools, one params object with
  path params by name, always await. context.user is who caused the event, owner is you (the
  flow's owner): "when I …" is context.user === owner.
- The code sees nothing but these names. Keep it small and safe to run twice.
- In test mode only *_get tools run; the others are recorded and return undefined.
- Judging text: ai1Api_decide_post({ content, question }) answers a yes/no question
  (.probabilities.yes); with options ["a", "b"] it picks one (.choice). In test mode it is skipped
  too: test such a flow with the user, then switch test mode off.
- Description short, in the user's language.

Example 1. The user: "Wenn ein deutscher Text geändert wird, übersetze ihn in alle Sprachen."

sandboxFlow_flows_post({
  "description": "Deutsche Texte übersetzen",
  "host": "db",
  "event": "table:update-after",
  "tools": ["core_languages_get", "cmsText_text_translate_post"],
  "code": "if (event.table !== 'text_lang' || event.data.lang !== 'de') return;\nconst { all } = await tools.core_languages_get();\nfor (const lang of all.filter((l) => l !== 'de')) await tools.cmsText_text_translate_post({ text: event.data.text_id, targetLang: lang, sourceLang: 'de' });\nreturn 'translated';"
})
→ { "id": 4 }

sandboxFlow_flow_test_post({
  "flow": 4,
  "event": { "table": "text_lang", "id": "12:de", "data": { "text_id": 12, "lang": "de", "text": "Willkommen auf unserer Seite." } }
})
→ the trace: the tool calls and the result; *_post calls are "skipped" in the test.

Example 2. The user: "Jeden Montag um 7 Uhr die Seite 5 in alle Sprachen übersetzen, was noch fehlt."

sandboxFlow_flows_post({
  "description": "Montags Seite 5 übersetzen",
  "host": "app",
  "event": "cron:hour",
  "tools": ["cmsText_page_translateAllLangs_post"],
  "code": "if (event.weekday !== 'monday' || event.hour !== 7) return;\nawait tools.cmsText_page_translateAllLangs_post({ page: 5, ifNeeded: true });\nreturn 'translated';"
})
```

## Not yet

- **Test mode goes by name, not by effect:** only `*_get` tools run, so a `POST` that changes nothing
  (`ai1Api_decide_post`) is skipped too and returns `undefined`. Plan: a route says it only reads
  (`Verb.readOnly`, `GET` by default), `toTools` passes it on as MCP's `annotations.readOnlyHint`, and a
  test run skips what is not read-only. Core vocabulary, needs an OK.
- **Events are not filtered by rights:** a flow sees every event of its host, whatever its owner may
  read — a flow on `table:insert-after` sees every row of every table. Its api is for superusers until then.
  Plan: a flow sees what its owner caused; events of others only where the event declares who may
  listen (like `access`/`guard` of an api route, e.g. `node:*` for who may read the node).
- **Runs live in memory:** a crash or restart loses a running run (at-most-once).
  Later, per flow: store the event before the run, delete it after, rerun what is left on start
  (at-least-once, code idempotent).
- **Runs are kept in memory only:** `history(app, id)` has the latest 20 of a flow of the table, newest
  first; runs without a tool call and a result (the event was not for it) are only counted. A restart
  forgets them; what a run changed is in the core log (actor `sandbox.flow`).
