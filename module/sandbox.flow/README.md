# sandbox.flow

When an event fires, runs a flow: a list of steps, each a description and a small function, in a
[sandbox](../sandbox/). The code sees only the tools the flow may use, and they run with the rights of
its owner. Mostly an AI writes the flow, with the same tools it used and tested while planning.

```ts
import { listen } from "@qino/qino/sandbox.flow";

listen(app, {
  description: "Deutsche Texte von mir übersetzen, wenn sie fertig aussehen",
  on: { source: "db", type: "table:update-after" },
  owner: 9,
  tools: ["post_ai1Api_decide", "get_core_languages", "post_cmsText_text_translate"],
  steps: [
    {
      description: "Nur deutsche Texte, die ich geändert habe",
      fn: (e, { context }) => e.table === "text_lang" && e.data.lang === "de" && context.user === 9 && e,
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
        return choice === "done" && e;
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
  result stops the run. `fn` is a function or its source — self-contained, it sees nothing else.
- **The event** arrives as data: objects of a class become their string form (a `DbTable` its name).
- **`context.user`:** who caused the event, taken as it fires.
- **`tools`:** the api's tools (`toTools`), only those named in `tools`, one params object each.
  They run in one request context per run, as `owner` (actor `sandbox.flow`), made by the first call.
- **One sandbox per listening flow**, shared by its runs: no worker start per event. Tool calls carry
  their run, so traces stay apart. A timeout in one run ends the worker and the flow's other runs.
- **`debounce`:** a step that waits `ms`; if a later run of the flow reaches it with the same key
  (`by`, a path into the value) meanwhile, this run ends as `superseded`.
- **`test: true`:** only `get_*` tools take effect; the others are recorded as `skipped`.
- **The trace** (`run()` returns it, `listen()` hands it to `report`): per step its result, error and
  tool calls; `end` is `done`, `stopped`, `superseded` or `error`.
- **Own events are ignored:** the run's request context is marked from the start (`runAs` with
  `state`), so the flow skips every event of the run — those of setting the context up included.

`run(app, flow, event, context)` runs a flow once, e.g. to test it on an example event.

## Not yet

- **Nothing persists:** flows are given in code, a debounce wait dies with the process. Tables for flows
  and waiting runs, resuming after a restart: [PLAN-automation.md](../../../PLAN-automation.md).
- **No stored traces:** they go to `report`; what a run changed is in the core log (actor
  `sandbox.flow`). A table for them once a backend or planner needs one.
