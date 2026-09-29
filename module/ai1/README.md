# ai1

**Goal.** ai1 replaces `ai`, rebuilt in logical layers:

- a complete AI harness
- simple, but brilliant
- automation
- self-improving

**One call per capability, whatever serves it.** The caller asks for a capability; ai1 picks the
model, falls back when it fails and reports each attempt.

```ts
import { decide, text, translate } from "@qino/qino/ai1";

await translate(app, { text: "<p>Hallo</p>", from: "de", to: "en", format: "html" });
await decide(app, { content: mail, question: "Is this spam?", options: ["yes", "no"] });
await translate(app, { text: ["Titel", "Hallo"], to: "en" }); // many at once: ["Title", "Hello"]
const { text: answer, truncated, model } = await text(app, "Hi"); // model: who answered
```

`text`, `structured`, `embed`, `image`, `transcribe` (speech to text), `speak` (text to speech), `translate`, `decide`: each is `request(app, capability, input)`.

## Models, providers, capabilities

- `ai1_model`: the model as a unit (`llama-3.3-70b`), its `context_length` (a longer request skips it), `enabled`.
- `ai1_model_capability`: what the model can do.
- `ai1_model_score`: how good it is: `intelligence`, `coding`, `math` … (higher is better).
- `ai1_provider`: endpoint, `type` (the adapter), `enabled`. Its key is `core.keys[name]`.
- `ai1_model_provider`: where the model runs: its name there (`provider_model`), `cost`, `speed`,
  `enabled`.

The candidates (model at a provider) go by the weights in `prefer`: `cost`
(cheaper is better), `speed`, `quality` and any score. `quality` is the score named like the
capability (`image`, `speak`: its own benchmark) where there is one, else `intelligence`. Each is scaled between the candidates' worst (0) and
best (1): cost and speed by ratio and without the outer tenth on each side (a few free or very
dear offers would squeeze the others together), scores as they are; unknown counts as worst. Only the ratio of
the weights matters. Without `prefer`: `{ quality: 2, cost: 1, speed: 1 }`.

```ts
await text(app, "Write a parser", { prefer: { coding: 9, cost: 5, speed: 1 } });
await candidates(app, "text", input, opts); // who would answer, in order — without calling
```

Capabilities are free words: the ones above plus features a request may need, `vision` (images
in the messages) and `tools`. A model is a candidate if it has the capability and every need.

## Fallback

1. Candidates by `prefer`. A pinned `model` (`opts.model`)
   goes first, but it still falls back.
2. A provider whose adapter can't serve the capability natively serves it through the capability's
   `via`: give a chat model `translate` and it translates by prompt.
3. At the end, the `via` capabilities themselves: no translation service means `translate` via `text`.

Embeddings never fall back to another model: its vectors wouldn't fit the index. Pin the model you
index with (`opts.model`).
Use `purpose: "index"` for stored content and `purpose: "query"` for search text. NVIDIA's
asymmetric embedding endpoint receives these as `input_type: "passage"` and `"query"`; Jina Omni
receives `task: "retrieval.passage"` and `"retrieval.query"`. A missing purpose defaults to indexing.
Set the provider type to `nvidia` or `jina` for those endpoints; both reuse the common OpenAI
operations. `embed(app, { images: [dataUrl] }, { model })` works with Jina Omni. The plain `openai`
adapter accepts text embeddings only.

A model at a provider that times out, is overloaded or fails with 5xx is skipped for a minute.
The timeout (`timeout_ms`) counts silence, not length: a long answer that keeps streaming is fine.
Once streamed text went out (`onText`), or the caller cancelled (`opts.signal`), nothing falls
back any more.

## Browser

[ai1.api](../ai1.api/) offers the capabilities to signed-in users.

## Watching

Every attempt fires `ai1:call` with `{ capability, id, model, provider, ms, input, output, error? }`
(`id` is the `ai1_model_provider`). [ai1.stats](../ai1.stats/) measures usage, errors and the
speed ai1 chooses by.

## Extending

Modules declare `ai1Adapters` (provider types) and `ai1Capabilities` (needs and fallbacks per
capability) in their plugin, as ai1 does for its own.
