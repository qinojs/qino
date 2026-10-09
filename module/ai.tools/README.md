# ai1.tools

The model uses tools: `run()` answers like [ai1](../ai1/)'s `text()`, but runs the tools the model
calls and asks again, until it answers without calling one.

```ts
import { run } from "@qino/qino/ai1.tools";

const { text, messages } = await run(app, { messages: [{ role: "user", content: "Rename page 7" }], tools: toTools(cmsApi), usrId });
```

- `tools` are the core's `Tool`s, with `execute`.
- The run acts as user `usrId`, with the rights of that user, in a context of its own (core
  `runAs`, actor `ai1`): one log entry per run, never the caller's request.
- A failing tool is told to the model (`{ error }`, with `code` and `data` of an `ApiError`); other
  errors only as "Tool failed", logged on the server.
- A result longer than 100,000 characters doesn't go to the model, it is told so (`{ error }`) and can
  ask for less.
- Tool calls of one step run one after the other.
- Each step prefers the model and provider of the previous answer; it can still fall back.
- `cache` (default true): the history each step sends again stays in the provider's cache (ai1).
- `maxSteps` (default 10) bounds the calls; beyond it `run()` throws.
- `messages` are the new ones (assistant and tool): keep them for a history. `onMessage` gets each as it
  comes, an answer with the model at its provider that gave it.
