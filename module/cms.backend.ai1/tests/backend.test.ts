// deno-lint-ignore-file no-explicit-any
import { Db, requestStorage } from "@qino/qino";
import { ai1Adapters, ai1Capabilities, ai1DbSchema, assert, assertEquals, assertStringIncludes, Emitter, fakeT, testContext } from "@qino/qino/tests";

import { dbSchema, record } from "@qino/m/ai1.stats/tests/deps.ts";

import { evaluate, importModels, key, unit } from "../lib/sources.ts";
import api from "../nodeApi.ts";
import { capabilities, view, widget } from "../render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// Keys like core.keys: reading awaits the value, calling sets it.
function keys(stored: Record<string, string>) {
  return new Proxy({}, {
    get: (_, name: string) => Object.assign((value?: string) => { value ? stored[name] = value : delete stored[name]; }, {
      then: (resolve: (v: unknown) => void) => resolve(stored[name]),
    }),
  });
}

async function setup(stored: Record<string, string> = {}) {
  const db = new Db("sqlite::memory:");
  const schema = { properties: { ...ai1DbSchema.properties, ...dbSchema.properties } };
  await db.migrate(schema);
  await db.loadTables();
  db.schema = schema;
  const mods = [{ name: "ai1", plugin: { ai1Adapters, ai1Capabilities } }];
  const events = new Emitter<any>();
  const app = {
    db, t: fakeT, on: events.on.bind(events), fire: events.fire.bind(events),
    settings: { core: { keys: keys(stored) } },
    modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods },
  } as unknown as App;
  return { app, node: { app } as unknown as Node, stored };
}

/** A view as the page renders it (its links need a request). */
const show = async (node: Node, vars: Record<string, unknown> = {}) =>
  String(await requestStorage.run(await testContext(), () => view(node, { vars })));

async function withFetch(answer: (url: string) => unknown, fn: () => Promise<void>) {
  const fetchOrg = globalThis.fetch;
  globalThis.fetch = (url) => Promise.resolve(Response.json(answer(String(url))));
  try { await fn(); }
  finally { globalThis.fetch = fetchOrg; }
}

Deno.test("cms.backend.ai1: capabilities come from adapters, capability definitions, needs and use", async () => {
  const { app } = await setup();
  await app.db.table("ai1_model").insert({ name: "m" });
  await app.db.table("ai1_model_capability").insert({ model_id: 1, capability: "summarize" });
  const caps = await capabilities(app);
  for (const c of ["text", "structured", "embed", "translate", "decide", "vision", "tools", "summarize"]) assert(caps.includes(c), c);
});

Deno.test("cms.backend.ai1: providers, models, capabilities and keys are managed through the node api", async () => {
  const { app, node, stored } = await setup();
  assertEquals(await api(node, { add: "provider", name: "api.test", type: "openai", endpoint: "https://x.test/v1" }), { ok: true });
  assertEquals(await api(node, { add: "model", name: "llama" }), { ok: true });
  assertEquals(await api(node, { add: "offer", model: 1, provider_id: 1 }), { ok: true });
  assertEquals(await api(node, { set: { table: "ai1_model_provider", id: 1, column: "cost_input", value: "0.5" } }), { ok: true });
  assertEquals(await api(node, { set: { table: "ai1_model_provider", id: 1, column: "cost_output", value: "1" } }), { ok: true });
  assertEquals(await api(node, { set: { table: "ai1_model_provider", id: 1, column: "speed", value: "" } }), { ok: true });
  assertEquals(await api(node, { set: { table: "ai1_model", id: 1, column: "context_length", value: "8192" } }), { ok: true });
  assertEquals(await api(node, { capability: { model: 1, name: "text", on: true } }), { ok: true });
  assertEquals(await api(node, { capability: { model: 1, name: "text", on: true } }), { ok: true }); // twice is once
  assertEquals(await api(node, { key: { provider: "api.test", value: " sk-123456 " } }), { ok: true });
  assertEquals(await api(node, { benchmarkKey: "aa" }), { ok: true, message: "Saved." });
  assertEquals(stored, { "api.test": "sk-123456", "artificialanalysis.ai": "aa" });
  assertEquals(await app.db.row`SELECT cost_input, cost_output, speed FROM ai1_model_provider`, { cost_input: 0.5, cost_output: 1, speed: null });
  assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability`, ["text"]);
  await api(node, { capability: { model: 1, name: "text", on: false } });
  assertEquals(await app.db.query`SELECT * FROM ai1_model_capability`, []);

  // only listed columns are writable
  assertEquals((await api(node, { set: { table: "usr", id: 1, column: "email", value: "x" } }) as any).ok, false);
  assertEquals((await api(node, { set: { table: "ai1_model_provider", id: 1, column: "used_input", value: 0 } }) as any).ok, false);
  assertEquals((await api(node, { remove: { table: "usr", id: 1 } }) as any).ok, false);
  assertEquals(await api(node, { remove: { table: "ai1_model", id: 1 } }), { ok: true });
  assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM ai1_model_provider`), 0); // cascades
});

Deno.test("cms.backend.ai1: the views render the matrix and the providers, escaped", async () => {
  const { app, node } = await setup({ "api.openai.com": "sk-abcdef1234" });
  await api(node, { add: "provider", name: "api.openai.com", type: "openai", endpoint: "https://x.test/v1" });
  await api(node, { add: "model", name: "<b>llama</b>" });
  await api(node, { add: "offer", model: 1, provider_id: 1 });
  await api(node, { capability: { model: 1, name: "text", on: true } });

  const matrix = await show(node);
  assertStringIncludes(matrix, "&lt;b&gt;llama&lt;/b&gt;");
  assertStringIncludes(matrix, "name=cost_input");
  assertStringIncludes(matrix, "name=cost_output");
  assertStringIncludes(matrix, 'data-capability="text" checked');
  assert(matrix.includes('title="Its providers">1</button>') && !matrix.includes("unusable")); // the count; the providers are in its dialog
  await api(node, { capability: { model: 1, name: "vision", on: true } });
  await api(node, { set: { table: "ai1_provider", id: 1, column: "enabled", value: false } });
  assert(!(await show(node)).includes("&lt;b&gt;llama")); // no provider serves it: hidden unless also unusable
  const changed = await show(node, { all: 1 });
  assertStringIncludes(changed, 'type=checkbox data-capability="vision" checked');
  assertStringIncludes(changed, "unusable"); // its only provider is off

  const list = await show(node, { show: "providers" });
  assert(!list.includes("[object Promise]") && !matrix.includes("[object Promise]"));
  assertStringIncludes(list, 'title="Get a key"'); // a catalog provider
  assertStringIncludes(list, "…1234");
  assertStringIncludes(String(await widget(app)), "<b>1</b> active models");
});

Deno.test("cms.backend.ai1: all models of every provider are imported, switched on, one per name", async () => {
  const { app, node } = await setup();
  await api(node, { add: "provider", name: "api.groq.com", type: "openai", endpoint: "https://api.groq.com/openai/v1" });
  await api(node, { add: "provider", name: "openrouter.ai", type: "openrouter", endpoint: "https://openrouter.ai/api/v1" });
  await api(node, { add: "model", name: "llama-3.3-70b" }); // exists
  await api(node, { set: { table: "ai1_model", id: 1, column: "enabled", value: false } }); // switched off by hand: stays off
  await withFetch((url) => url.includes("models.dev") ? {} : {
    data: url.includes("groq") ? [{ id: "llama-3.3-70b" }, { id: "whisper-large-v3" }] : [{ id: "meta-llama/Llama-3.3-70B" }],
  }, async () => {
    assertStringIncludes(await evaluate(app), "api.groq.com: 2 (2 new)");
    await evaluate(app); // twice is once
  });
  assertEquals(await app.db.query`SELECT name, enabled FROM ai1_model ORDER BY name`, [
    { name: "jev-1.13", enabled: 1 }, // from the catalog: OpenRouter's /models doesn't list it
    { name: "llama-3.3-70b", enabled: 0 },
    { name: "whisper-large-v3", enabled: 1 },
  ]);
  assertEquals(await app.db.query`
    SELECT m.name, p.name AS provider, mp.provider_model FROM ai1_model_provider mp
    JOIN ai1_model m ON m.id = mp.model_id JOIN ai1_provider p ON p.id = mp.provider_id ORDER BY m.name, p.name`, [
    { name: "jev-1.13", provider: "openrouter.ai", provider_model: "typesafe/jev-1.13" }, // priced by the catalog
    { name: "llama-3.3-70b", provider: "api.groq.com", provider_model: "" },
    { name: "llama-3.3-70b", provider: "openrouter.ai", provider_model: "meta-llama/Llama-3.3-70B" },
    { name: "whisper-large-v3", provider: "api.groq.com", provider_model: "" },
  ]);
  assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability WHERE model_id = (SELECT id FROM ai1_model WHERE name = 'jev-1.13')`, ["decide"]);
  assertEquals(await app.db.row`SELECT cost_input, cost_output FROM ai1_model_provider WHERE provider_model = 'typesafe/jev-1.13'`, { cost_input: 0.036, cost_output: 0.036 }); // the catalog's price

  // the active ones, all on request, filtered by provider
  assert(!(await show(node)).includes('value="llama-3.3-70b"'));
  assertStringIncludes(await show(node, { all: 1 }), 'value="llama-3.3-70b"');
  const atOpenrouter = await show(node, { all: 1, provider: 2 });
  assert(atOpenrouter.includes("jev-1.13") && !atOpenrouter.includes("whisper"));
  assertStringIncludes(await show(node, { show: "providers" }), ">1 / 2<"); // active / all

  // all the filter matches, on or off
  assertEquals(await api(node, { switch: { provider: 1, on: false } }), { ok: true, message: "2 models off" });
  assertEquals(await app.db.col`SELECT name FROM ai1_model WHERE enabled = ${true}`, ["jev-1.13"]);
  assertEquals(await api(node, { switch: { q: "llama", on: true } }), { ok: true, message: "1 models on" });
  assertEquals(await app.db.col`SELECT name FROM ai1_model WHERE enabled = ${true} ORDER BY name`, ["jev-1.13", "llama-3.3-70b"]);
  await api(node, { add: "provider", name: "api-free.deepl.com", type: "deepl", endpoint: "https://api-free.deepl.com/v2" });
  await withFetch(() => ({}), () => evaluate(app).then(() => {}));
  const deepl = Number(await app.db.one`SELECT id FROM ai1_model WHERE name = 'deepl'`);
  assertEquals(await app.db.query`SELECT metric, value FROM ai1_model_score WHERE model_id = ${deepl}`, [{ metric: "intelligence", value: 35 }]); // judged within translating
});

const MODELS_DEV = {
  groq: { id: "groq", doc: "https://console.groq.com/docs", models: { "llama-3.3-70b-versatile": { id: "llama-3.3-70b-versatile", tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 131072 }, cost: { input: 0.59, output: 0.79 } } } },
  embedder: { id: "embedder", models: { "text-embedding-3-small": { id: "text-embedding-3-small", family: "text-embedding", modalities: { input: ["text"], output: ["text"] } } } },
  voice: { id: "voice", models: { "tts-1": { id: "tts-1", modalities: { input: ["text"], output: ["audio"] } } } },
  painter: { id: "painter", models: { "gpt-5-image": { id: "gpt-5-image", modalities: { input: ["text", "image"], output: ["image", "text"] } } } },
  whisper: { id: "whisper", models: { "whisper-large-v3": { id: "whisper-large-v3", modalities: { input: ["audio"], output: ["text"] } } } },
  deepinfra: { id: "deepinfra", models: { "meta-llama/Llama-3.3-70B-Instruct": { id: "meta-llama/Llama-3.3-70B-Instruct", structured_output: true, modalities: { input: ["text", "image"], output: ["text"] }, cost: { input: 0.1, output: 0.3 } } } },
};
const today = new Date().toISOString().slice(0, 10);
const BENCHMARKS = { data: [
  { slug: "old-math-model", name: "Old", release_date: "2025-06-01", evaluations: { artificial_analysis_math_index: 80 } }, // math is measured no more
  { slug: "gpt-6", name: "GPT-6", release_date: today, evaluations: {}, median_output_tokens_per_second: 0 }, // measured only per reasoning level
  { slug: "gpt-6-high", name: "GPT-6 (high)", evaluations: { artificial_analysis_coding_index: 50 }, median_output_tokens_per_second: 80 },
  { slug: "gpt-6-low", name: "GPT-6 (low)", evaluations: { artificial_analysis_coding_index: 30 }, median_output_tokens_per_second: 60 },
  { slug: "gpt-6-medium", name: "GPT-6 (medium)", evaluations: { artificial_analysis_coding_index: 40 }, median_output_tokens_per_second: 70 },
  { slug: "llama-3-3-instruct-70b", name: "Llama 3.3 Instruct 70B", release_date: today, evaluations: { artificial_analysis_intelligence_index: 28, artificial_analysis_coding_index: 22, aa_omniscience_index: 5, gpqa: 0.5, note: "text" }, median_output_tokens_per_second: 150 },
] };

/** llama at groq and at deepinfra (by its full name); disabled providers do not import offers. */
async function llama(keys: Record<string, string> = {}) {
  const { app, node } = await setup(keys);
  await app.db.table("ai1_provider").insert({ name: "api.groq.com", type: "openai", endpoint: "https://api.groq.com/openai/v1", enabled: false });
  await app.db.table("ai1_provider").insert({ name: "api.deepinfra.com", type: "openai", endpoint: "https://api.deepinfra.com/v1/openai", enabled: false });
  await app.db.table("ai1_model").insert({ name: "llama-3.3-70b" });
  await app.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1, provider_model: "llama-3.3-70b-versatile" });
  await app.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 2, provider_model: "meta-llama/Llama-3.3-70B-Instruct" });
  return { app, node };
}

Deno.test("cms.backend.ai1: names match across spellings", () => {
  assertEquals(key("llama-3.3-70b"), key("Llama-3-3-Instruct-70B"));
  assertEquals(unit("meta-llama/Llama-3.3-70B"), "llama-3.3-70b");
  assert(key("llama-3.1-8b") !== key("llama-3.3-70b"));
});

Deno.test("cms.backend.ai1: models.dev and Artificial Analysis fill prices, capabilities, context and scores", async () => {
  const { app, node } = await llama({ "artificialanalysis.ai": "aa-key" });
  await app.db.table("ai1_model_score").insert({ model_id: 1, metric: "math", value: 60 }); // from an earlier import
  await withFetch((url) => url.includes("models.dev") ? MODELS_DEV : BENCHMARKS, async () => {
    assertStringIncludes(await evaluate(app), "models.dev: 2 · Artificial Analysis: 1");
  });
  assertEquals(await app.db.query`SELECT cost_input, cost_output FROM ai1_model_provider ORDER BY id`, [
    { cost_input: 0.59, cost_output: 0.79 }, { cost_input: 0.1, cost_output: 0.3 },
  ]);
  assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability ORDER BY capability`, ["structured", "text", "tools", "vision"]);
  await app.db.table("ai1_model").insert({ name: "whisper-large-v3" });
  await app.db.table("ai1_model_provider").insert({ model_id: 2, provider_id: 1 });
  await withFetch(() => MODELS_DEV, () => evaluate(app).then(() => {}));
  assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability WHERE model_id = 2`, ["transcribe"]); // audio in, text out: speech to text, no chat
  await app.db.table("ai1_model").insert({ name: "gpt-5-image" });
  await app.db.table("ai1_model_provider").insert({ model_id: 3, provider_id: 1 });
  await withFetch(() => MODELS_DEV, () => evaluate(app).then(() => {}));
  assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability WHERE model_id = 3 ORDER BY capability`, ["image", "text", "vision"]);
  await app.db.table("ai1_model").insert({ name: "tts-1" });
  await app.db.table("ai1_model_provider").insert({ model_id: 4, provider_id: 1 });
  await withFetch(() => MODELS_DEV, () => evaluate(app).then(() => {}));
  assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability WHERE model_id = 4`, ["speak"]); // text in, only audio out
  await app.db.table("ai1_model").insert({ name: "text-embedding-3-small" });
  await app.db.table("ai1_model_provider").insert({ model_id: 5, provider_id: 1 });
  await withFetch(() => MODELS_DEV, () => evaluate(app).then(() => {}));
  assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability WHERE model_id = 5`, ["embed"]); // "text" out by models.dev, but no chat model
  assertEquals(Number(await app.db.one`SELECT context_length FROM ai1_model`), 131072);
  assertEquals(await app.db.query`SELECT metric, value FROM ai1_model_score ORDER BY metric`, [ // the indexes, named for prefer; not the benchmarks behind them
    { metric: "coding", value: 22 },
    { metric: "intelligence", value: 28 },
    { metric: "omniscience", value: 5 },
    { metric: "tokens_per_second", value: 150 },
  ]);
  assertEquals(await app.db.col`SELECT speed FROM ai1_model_provider WHERE model_id = 1`, [150, 150]);
  const gpt6 = Number(await app.db.table("ai1_model").insert({ name: "gpt-6" }));
  await withFetch((url) => url.includes("models.dev") ? MODELS_DEV : BENCHMARKS, () => evaluate(app).then(() => {}));
  assertEquals(await app.db.query`SELECT metric, value FROM ai1_model_score WHERE model_id = ${gpt6} ORDER BY metric`, [
    { metric: "coding", value: 40 }, // the median of its levels'
    { metric: "tokens_per_second", value: 70 },
  ]);

  const out = await show(node);
  const at = (name: string) => out.indexOf(`">${name}`);
  assert(at("intelligence") > 0 && at("intelligence") < at("coding")); // indexes as columns, intelligence first
});

Deno.test("cms.backend.ai1: shows the measured calls", async () => {
  const { app, node } = await llama();
  for (const [ms, input, output, error] of [[8_000, 10, 800], [4_000, 10, 400], [100, 0, 0, "HTTP 503"], [50, 30, 0]] as const) {
    await record(app, { id: 1, capability: "text", ms, input, output, error });
  }
  const out = await show(node, { all: 1 });
  assert(out.includes("25 %") && out.includes("HTTP 503"));
  assertStringIncludes(await show(node, { show: "providers" }), ">50 / 1,200");
});

Deno.test("cms.backend.ai1: try shows who would answer by the weights, and who did", async () => {
  const { app, node } = await setup();
  assertStringIncludes((await api(node, { try: { capability: "text", input: { messages: [] }, prefer: {} } }) as any).message, 'No model for "text"');
  assertEquals(await api(node, { try: { capability: "transcribe", input: { file: "https://elsewhere.test/a.mp3" }, prefer: {} } }), { ok: false, message: "A file is expected" }); // an upload, never a URL to fetch
  assertStringIncludes((await api(node, { preview: { prefer: { cost: "a lot" } } }) as any).message, "Weights");

  const answering = { text: (call: any) => Promise.resolve({ text: `${call.model} says hi`, toolCalls: [], truncated: false }) };
  (app.modules.linked() as any)[0].plugin.ai1Adapters = { ...ai1Adapters, fake: answering };
  await app.db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  for (const [name, coding] of [["smart", 50], ["cheap", 20]] as const) {
    const model = await app.db.table("ai1_model").insert({ name });
    await app.db.table("ai1_model_provider").insert({ model_id: model, provider_id: 1, cost_input: name === "cheap" ? 1 : 10, cost_output: name === "cheap" ? 1 : 10 });
    await app.db.table("ai1_model_capability").insert({ model_id: model, capability: "text" });
    await app.db.table("ai1_model_score").insert({ model_id: model, metric: "coding", value: coding });
  }
  assertEquals((await api(node, { preview: { prefer: { coding: 1 } } }) as any).list.map((c: any) => c.model), ["smart", "cheap"]);
  assertEquals((await api(node, { preview: { prefer: { cost: 1 } } }) as any).list.map((c: any) => c.model), ["cheap", "smart"]);
  // translate: nobody directly here, so the text models by prompt
  assertEquals((await api(node, { preview: { capability: "translate", input: { text: "Hallo", to: "en" }, prefer: { cost: 1 } } }) as any).list.map((c: any) => [c.model, c.via]), [["cheap", "text"], ["smart", "text"]]);
  const res = await api(node, { try: { capability: "text", input: { messages: [{ role: "user", content: "hi" }] }, prefer: { cost: 1 } } }) as any;
  assertEquals([res.result.text, res.tried.map((c: any) => [c.model, c.provider])], ["cheap says hi", [["cheap", "fake"]]]);
});

Deno.test("cms.backend.ai1: Jina catalog excludes models unavailable at chat completions", async () => {
  const { app, node } = await setup();
  await app.db.table("ai1_provider").insert({ name: "api.jina.ai", type: "jina", endpoint: "https://api.jina.ai/v1" });
  const old = await app.db.table("ai1_model").insert({ name: "jina-reranker-v3" });
  await app.db.table("ai1_model_capability").insert({ model_id: old, capability: "text" });
  await app.db.table("ai1_model_provider").insert({ model_id: old, provider_id: 1 });
  const list = { data: [
    { id: "jina-ai/jina-reranker-v3", input_modalities: ["text"], output_modalities: ["text"], supported_sampling_parameters: [], supported_features: [] },
    { id: "jina-ai/ReaderLM-v2", input_modalities: ["text"], output_modalities: ["text"], supported_sampling_parameters: [], supported_features: [] },
    { id: "jina-ai/jina-ocr-v1", input_modalities: ["text", "image"], output_modalities: ["text"], supported_sampling_parameters: ["temperature"], supported_features: ["streaming"] },
    { id: "jina-ai/jina-embeddings-v4", input_modalities: ["text"], output_modalities: ["embeddings"], supported_sampling_parameters: [], supported_features: [] },
  ] };
  await withFetch((url) => url.endsWith("/embeddings/models") ? { data: [] } : list, async () => { await importModels(app); });
  assertEquals(await app.db.query`SELECT m.name, mp.enabled FROM ai1_model_provider mp JOIN ai1_model m ON m.id = mp.model_id ORDER BY m.name`, [
    { name: "jina-embeddings-v4", enabled: 1 }, { name: "jina-ocr-v1", enabled: 1 }, { name: "jina-reranker-v3", enabled: 0 },
  ]);
  assertEquals((await api(node, { preview: { capability: "text", input: { messages: [] }, prefer: {} } }) as any).list.map((c: any) => c.model), ["jina-ocr-v1"]);
});

Deno.test("cms.backend.ai1: try includes the provider's raw body on success and failure", async () => {
  const { app, node } = await setup();
  const mod = (app.modules.linked() as any)[0];
  mod.plugin.ai1Adapters = { ...ai1Adapters, fake: { text: async (call: any) => {
    const response = await call.fetch("/answer");
    return { text: (await response.json()).text, toolCalls: [], truncated: false };
  } } };
  await app.db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "https://fake.test" });
  const model = await app.db.table("ai1_model").insert({ name: "m" });
  await app.db.table("ai1_model_provider").insert({ model_id: model, provider_id: 1 });
  await app.db.table("ai1_model_capability").insert({ model_id: model, capability: "text" });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.resolve(Response.json({ text: "hello" }));
    const success = await api(node, { try: { capability: "text", input: { messages: [] }, prefer: {} } }) as any;
    assertEquals([success.ok, success.result.text, success.raw[0].body], [true, "hello", '{"text":"hello"}']);
    globalThis.fetch = () => Promise.resolve(Response.json({ error: "denied" }, { status: 403 }));
    const failure = await api(node, { try: { capability: "text", input: { messages: [] }, prefer: {} } }) as any;
    assertEquals([failure.ok, failure.raw[0].status, failure.raw[0].body], [false, 403, '{"error":"denied"}']);
  } finally { globalThis.fetch = original; }
});

Deno.test("cms.backend.ai1: a provider's own description wins; a variant is another offer of the model", async () => {
  const { app, node } = await setup();
  await api(node, { add: "provider", name: "openrouter.ai", type: "openrouter", endpoint: "https://openrouter.ai/api/v1" });
  const old = await app.db.table("ai1_model_provider").insert({ model_id: await app.db.table("ai1_model").insert({ name: "old" }), provider_id: 1, provider_model: "x/old:batch" });
  await record(app, { id: Number(old), capability: "text", ms: 1, input: 1, output: 1, error: "asynchronous only" }); // an earlier import took it
  const embeddings = { data: [{ id: "voyageai/voyage-code-4", architecture: { input_modalities: ["text"], output_modalities: ["embeddings"] } }] };
  const listed = { data: [
    { id: "openai/gpt-6-sol", context_length: 400000, pricing: { prompt: "0.000002", completion: "0.000008" }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools", "response_format"] },
    { id: "openai/gpt-6-sol:free", pricing: { prompt: "0", completion: "0" } },
    { id: "openai/gpt-6-sol:batch", pricing: { prompt: "0.000001", completion: "0.000004" } }, // asynchronous only: left out
    { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } }, // varies: no price
  ] };
  await api(node, { add: "provider", name: "aihubmix.com", type: "openai", endpoint: "https://aihubmix.com/v1" });
  const modelsDev = { openrouter: { id: "openrouter", api: "https://openrouter.ai/api/v1", models: { "openai/gpt-6-sol": { id: "openai/gpt-6-sol", cost: { input: 99, output: 99 } } } } };
  await withFetch((url) => url.includes("models.dev") ? modelsDev : url.includes("aihubmix") ? (url.endsWith("/embeddings/models") ? {} : { data: [{ id: "gpt-6_sol" }] }) : url.endsWith("/embeddings/models") ? embeddings : listed, () => evaluate(app).then(() => {}));
  assertEquals(await app.db.query`
    SELECT m.name, mp.provider_model FROM ai1_model_provider mp JOIN ai1_model m ON m.id = mp.model_id ORDER BY mp.id`, [
    { name: "gpt-6-sol", provider_model: "openai/gpt-6-sol" },
    { name: "gpt-6-sol", provider_model: "openai/gpt-6-sol:free" },
    { name: "auto", provider_model: "openrouter/auto" },
    { name: "voyage-code-4", provider_model: "voyageai/voyage-code-4" }, // from /embeddings/models
    { name: "jev-1.13", provider_model: "typesafe/jev-1.13" },
    { name: "gpt-6-sol", provider_model: "gpt-6_sol" }, // the same model, written otherwise
  ]);
  assertEquals(await app.db.one`SELECT COUNT(*) FROM ai1_model_provider_stat WHERE model_provider_id = ${old}`, 0); // gone with its offer
  assertEquals(await app.db.query`SELECT cost_input, cost_output FROM ai1_model_provider ORDER BY id`, [
    { cost_input: 2, cost_output: 8 }, { cost_input: 0, cost_output: 0 },
    { cost_input: null, cost_output: null }, { cost_input: null, cost_output: null },
    { cost_input: 0.036, cost_output: 0.036 }, { cost_input: null, cost_output: null },
  ]);
  assertEquals(await app.db.col`SELECT c.capability FROM ai1_model_capability c JOIN ai1_model m ON m.id = c.model_id WHERE m.name = 'voyage-code-4'`, ["embed"]);
  const sol = await app.db.one`SELECT id FROM ai1_model WHERE name = 'gpt-6-sol'`;
  assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability WHERE model_id = ${sol} ORDER BY capability`, ["structured", "text", "tools", "vision"]);
  assertEquals(Number(await app.db.one`SELECT context_length FROM ai1_model WHERE id = ${sol}`), 400000);
});

Deno.test("cms.backend.ai1: the arenas' Elo becomes the score named like the capability", async () => {
  const { app } = await setup({ "artificialanalysis.ai": "aa-key" });
  await app.db.table("ai1_model").insert({ name: "gpt-image-2" });
  await app.db.table("ai1_model").insert({ name: "sonic-3-6" });
  await app.db.table("ai1_model").insert({ name: "gemini-3.1-flash-image" }); // named in the arena's brackets
  const arenas = (url: string) =>
    url.includes("text-to-image") ? { data: [{ slug: "gpt-image-2", name: "GPT Image 2", elo: 1171 }, { slug: "nano-banana-2", name: "Nano Banana 2 (Gemini 3.1 Flash Image)", elo: 1150 }] }
    : url.includes("text-to-speech") ? { data: [{ slug: "sonic-3-6", name: "Sonic 3.6", elo: 1276 }] }
    : { data: [] };
  await withFetch(arenas, async () => {
    assertStringIncludes(await evaluate(app), "Artificial Analysis: 3");
  });
  assertEquals(await app.db.query`SELECT model_id, metric, value FROM ai1_model_score ORDER BY model_id`, [
    { model_id: 1, metric: "image", value: 1171 },
    { model_id: 2, metric: "speak", value: 1276 },
    { model_id: 3, metric: "image", value: 1150 },
  ]);
});

Deno.test("cms.backend.ai1: a model the arena doesn't name is found by its description", async () => {
  const { app, node } = await setup({ "artificialanalysis.ai": "aa-key" });
  await api(node, { add: "provider", name: "openrouter.ai", type: "openrouter", endpoint: "https://openrouter.ai/api/v1" });
  const listed = { data: [
    { id: "openai/gpt-5-image", description: "GPT-5 Image combines GPT-5 with GPT Image 1's superior instruction following.", architecture: { input_modalities: ["text"], output_modalities: ["image", "text"] } },
    { id: "openai/gpt-5-image-mini", description: "GPT-5 Image Mini … with GPT Image 1 Mini for efficient image generation.", architecture: { input_modalities: ["text"], output_modalities: ["image", "text"] } },
    { id: "openai/gpt-5.4-image-2", description: "… image generation capabilities from GPT Image 2.", architecture: { input_modalities: ["text"], output_modalities: ["image", "text"] } },
  ] };
  const arena = { data: [
    { slug: "openai-gpt_gpt-image-1--high", name: "GPT Image 1 (high)", elo: 1100 },
    { slug: "openai-gpt_gpt-image-1-mini--medium", name: "GPT Image 1 Mini (medium)", elo: 1000 },
    { slug: "openai-gpt_image-1-5", name: "GPT Image 1.5 (high)", elo: 1150 },
    { slug: "gpt-image-2", name: "GPT Image 2 (high)", elo: 1171 },
  ] };
  await withFetch((url) => url.includes("text-to-image") ? arena : url.includes("artificialanalysis") || url.includes("models.dev") || url.includes("/embeddings/") ? {} : listed, () => evaluate(app).then(() => {}));
  assertEquals(await app.db.query`SELECT m.name, s.value FROM ai1_model_score s JOIN ai1_model m ON m.id = s.model_id WHERE s.metric = 'image' ORDER BY m.name`, [
    { name: "gpt-5-image", value: 1100 }, // GPT Image 1 — not 1.5
    { name: "gpt-5-image-mini", value: 1000 }, // the longer name wins
    { name: "gpt-5.4-image-2", value: 1171 }, // at the end of a sentence
  ]);
});

Deno.test("cms.backend.ai1: a provider with plain ids gets its models without the org/ its list puts before", async () => {
  const { app, node } = await setup();
  await api(node, { add: "provider", name: "api.jina.ai", type: "openai", endpoint: "https://api.jina.ai/v1" });
  assertEquals(await app.db.one`SELECT type FROM ai1_provider WHERE name = ${"api.jina.ai"}`, "jina");
  assertEquals((await api(node, { set: { table: "ai1_provider", id: 1, column: "type", value: "openai" } }) as any).ok, false);
  await app.db.exec`UPDATE ai1_provider SET type = ${"openai"} WHERE name = ${"api.jina.ai"}`;
  const listed = { data: [
    { id: "jina-ai/jina-embeddings-v3", pricing: { prompt: "0.00000005", completion: "0" }, input_modalities: ["text"], output_modalities: ["embeddings"] },
    { id: "jina-ai/jina-embeddings-v5-omni-small", input_modalities: ["text", "image"], output_modalities: ["embeddings"] },
  ] };
  await withFetch((url) => url.endsWith("/v1/models") ? listed : {}, () => evaluate(app).then(() => {}));
  assertEquals(await app.db.one`SELECT type FROM ai1_provider WHERE name = ${"api.jina.ai"}`, "jina");
  assertEquals(await app.db.query`SELECT m.name, mp.provider_model FROM ai1_model_provider mp JOIN ai1_model m ON m.id = mp.model_id`, [
    { name: "jina-embeddings-v3", provider_model: "" }, // called as jina-embeddings-v3, as Jina's API wants
    { name: "jina-embeddings-v5-omni-small", provider_model: "" },
  ]);
  assertEquals(await app.db.query`SELECT m.name, c.capability FROM ai1_model_capability c JOIN ai1_model m ON m.id = c.model_id ORDER BY m.name, c.capability`, [
    { name: "jina-embeddings-v3", capability: "embed" },
    { name: "jina-embeddings-v5-omni-small", capability: "embed" },
    { name: "jina-embeddings-v5-omni-small", capability: "vision" },
  ]);
});
