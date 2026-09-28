# ai1.tools

The model uses tools: `run()` answers like [ai1](../ai1/)'s `text()`, but runs the tools the model
calls and asks again, until it answers without calling one.

```ts
import { run } from "@qino/qino/ai1.tools";

const { text, messages } = await run(app, { messages: [{ role: "user", content: "Rename page 7" }], tools: toTools(cmsApi) });
```

- `tools` are the core's `Tool`s, with `execute`. Api tools (`toTools`) check access against the
  request, so they need one.
- A failing tool is told to the model (`{ error }`, with `code` and `data` of an `ApiError`); other
  errors only as "Tool failed", logged on the server.
- Tool calls of one step run one after the other.
- `maxSteps` (default 8) bounds the calls; beyond it `run()` throws.
- `messages` are the new ones (assistant and tool): keep them for a history.
