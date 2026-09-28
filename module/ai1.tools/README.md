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
- Tool calls of one step run one after the other.
- `maxSteps` (default 8) bounds the calls; beyond it `run()` throws.
- `messages` are the new ones (assistant and tool): keep them for a history.
