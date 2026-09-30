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
      debounce: { ms: 120_000, by: "id.text_id" },
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
          await tools.post_cmsText_text_translate({ text: e.id.text_id, targetLang: lang, sourceLang: "de" });
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
- **`context.user`:** who caused the event, taken as it fires.
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
catalog            get            per host its events (description, data as JSON Schema), and the tables
flows              get · post     your flows · make one, owned by you
flows/:flow        get · patch · delete
flows/:flow/test   post { event, user? }   try it on an example event, always as a test run → the trace
```

A flow belongs to who made it: to anyone else it answers like a missing one. Its tools run with the
owner's rights, so a flow never does more than its owner could.

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
