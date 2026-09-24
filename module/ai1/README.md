# ai1

**One call per capability, whatever serves it.** The caller asks for a capability; ai1 picks the
model, falls back when it fails and counts the usage.

```ts
import { decide, text, translate } from "@qino/qino/ai1";

await translate(app, { text: "<p>Hallo</p>", from: "de", to: "en", format: "html" });
await decide(app, { text: mail, question: "Is this spam?", options: ["yes", "no"] });
const { text: answer, truncated } = await text(app, "Hi");
```

`text`, `object`, `embed`, `image`, `transcribe`, `translate`, `decide`: each is `run(app, capability, input)`.

## Models, providers, capabilities

- `ai1_model`: the model as a unit (`llama-3.3-70b`), `enabled`.
- `ai1_model_capability`: what the model can do, with a `priority` per capability.
- `ai1_provider`: endpoint, `type` (the adapter), `enabled`. Its key is `core.keys[name]`.
- `ai1_model_provider`: where the model runs: its name there (`provider_model`), `cost`, `speed`,
  `enabled`, the usage.

The choice falls on a model first, then on one of its providers: the cheapest by default, the
fastest with `{ prefer: "speed" }`.

Capabilities are free words: the ones above plus features a request may need, `vision` (images
in the messages) and `tools`. A model is a candidate if it has the capability and every need.

## Fallback

1. Candidates by priority, each model through all its providers. A pinned `model` (`opts.model`)
   goes first, but it still falls back.
2. A provider whose adapter can't serve the capability natively serves it through the task's `via`:
   give a chat model `translate` and it translates by prompt, even ahead of DeepL.
3. At the end, the `via` capabilities themselves: no translation service means `translate` via `text`.

A model at a provider that times out, is overloaded or fails with 5xx is skipped for a minute.
The timeout (`timeout_ms`) counts silence, not length: a long answer that keeps streaming is fine.
Once streamed text went out (`onText`), or the caller cancelled (`opts.signal`), nothing falls
back any more.

## Extending

Modules declare `ai1Adapters` (provider types) and `ai1Tasks` (needs and fallbacks per
capability) in their plugin, as ai1 does for its own.
