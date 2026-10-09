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
await decide(app, { content: mail, question: "Is this spam?" });
// { choice: "yes", probabilities: { yes: .9, no: .1 }, confidence: .53 }
await translate(app, { text: ["Titel", "Hallo"], to: "en" }); // many at once: ["Title", "Hello"]
const { text: answer, truncated, model } = await text(app, "Hi"); // model: who answered
```

`text`, `structured`, `embed`, `image`, `transcribe` (speech to text), `speak` (text to speech), `ocr` (image to Markdown), `translate`, `decide`, `live`: each is `request(app, capability, input)`.

**`live`** talks by voice. The browser's WebRTC offer (`sdp`) goes to the server, which hands it to
the provider with instructions and tools; the media then flow straight between browser and provider.
What is said and the tool calls come to the server (`onMessage`, `onToolCall`), so the browser runs
no tools and sees no instructions. The browser side is [`pub/live.js`](pub/live.js). The neutral
interface is ai1's; each provider type speaks its own protocol in its adapter (OpenAI Realtime:
[`lib/openai.realtime.ts`](lib/openai.realtime.ts)). Give a realtime model (e.g. `gpt-realtime-2.1`
at an `openai` provider) the capability `live`. Its usage is not counted yet.

**`decide`** picks one of `options` — names, or `{ name: what it means }`; without options it is a yes/no
question (does it hold?). It answers `{ choice, probabilities, confidence }`: every option's probability,
the likeliest one, and how clear that is (1 − entropy / log n: 1 all on one, 0 even). Jev decides natively
(a noul without options); a provider without probabilities puts all on its choice.

Native decisions use the same `state`, `questions`, `answers` protocol across compatible services.
The `systemone` adapter appends `/systemone` to `ai1_provider.endpoint`; `decisions` appends
`/decisions`. Both serve `decide` on text and preserve the returned probabilities. Invalid or
incomplete probabilities fail the attempt and allow the usual fallback.

| Service / route | Provider type | Endpoint (without the operation path) | Example `provider_model` |
| --- | --- | --- | --- |
| TypeSafe | `systemone` | `https://api.typesafe.ai/v1` | `jev-latest` |
| Liquid AI | `systemone` | `https://api.liquid.ai/decisions/v1` | `d1:free` |
| OpenRouter System One | `openrouter` | `https://openrouter.ai/api/v1` | `typesafe/jev-1.13` |
| OpenRouter Decisions | `decisions` | `https://openrouter.ai/api/alpha` | `typesafe/jev-1.13` |
| NanoGPT System One | `systemone` | `https://nano-gpt.com/api/v1` | `jev-latest` |
| NanoGPT Decisions | `decisions` | `https://nano-gpt.com/api/v1` | `typesafe/jev-latest` |

Endpoints and model names are configured data, not inferred from hostnames. Register the model's
`decide` capability, link it to the provider, and store its key under `core.keys[provider.name]`.
`provider_model` is the provider's exact model ID; ai1 does not rewrite it. The `openrouter` adapter
keeps its existing chat, image and System One operations; `systemone` and `decisions` serve only
native decisions.

Protocol references: [TypeSafe HTTP API](https://docs.typesafe.ai/api),
[Liquid decision models](https://docs.liquid.ai/lfm/models/decision-models),
[OpenRouter System One](https://openrouter.ai/docs/guides/community/typesafe-sdk),
[OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request),
[NanoGPT Jev](https://nano-gpt.com/models/text/typesafe/jev-latest).
Perplexity's reported `/v1/decisions` route can use
`decisions` with endpoint `https://api.perplexity.ai/v1` only if it implements the same protocol;
its hosted HTTP contract has not been verified here. SDK/binding gateways (Vercel, Cloudflare,
Netlify) and differently shaped LiteLLM routes need their own adapter integration.
Tests mock HTTP responses; no provider has been called with live credentials for this change.

## Models, providers, capabilities

- `ai1_model`: the model as a unit (`llama-3.3-70b`), its `context_length` (a longer request skips it), `enabled` (what its offers are by default).
- `ai1_model_capability`: what the model can do.
- `ai1_model_score`: how good it is: `intelligence`, `coding`, `math` … (higher is better).
- `ai1_provider`: endpoint, `type` (the adapter), `enabled` (what its offers are by default). Its key is `core.keys[name]`.
- `ai1_model_provider`: where the model runs: its name there (`provider_model`), `cost`, `speed`,
  `enabled`: calls go by this alone.

[cms.backend.ai1](../cms.backend.ai1/) fills them: providers from a catalog of known ones, their
models via `/models` (new ones on where their provider and model are), context, prices and capabilities from models.dev, every
Artificial Analysis benchmark as a score (key `core.keys["artificialanalysis.ai"]`), daily by cron.

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

1. Candidates by `prefer`. A pinned model provider (`opts.modelProvider`) goes first, then a pinned
   model (`opts.model`); both still fall back.
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

`cache: true` in the input keeps the prompt in the provider's cache where it caches only when asked
(OpenRouter for Anthropic): a cache hit costs a tenth, a write a quarter more. Off by default, as a
single call gains nothing; `run()` of ai1.tools sets it, its steps send the same start again. OpenAI,
Gemini and others cache on their own.

## Browser

[ai1.api](../ai1.api/) offers the capabilities to signed-in users; [`pub/live.js`](pub/live.js) is the
browser side of `live`.

## Watching

Every attempt fires `ai1:call` with `{ capability, id, model, provider, ms, input, output, error? }`
(`id` is the `ai1_model_provider`). [ai1.stats](../ai1.stats/) measures usage, errors and the
speed ai1 chooses by.

## Extending

Modules declare `ai1Adapters` (provider types) and `ai1Capabilities` (needs and fallbacks per
capability) in their plugin, as ai1 does for its own.
