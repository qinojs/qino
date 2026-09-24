// deno-lint-ignore-file no-explicit-any
import { Db } from "@qino/qino";
import { ai1DbSchema, assert, assertEquals, fakeT } from "@qino/qino/tests";

import dbSchema from "../dbschema.json" with { type: "json" };
import { applySpeed, evaluate, key, record } from "../lib/eval.ts";
import { list } from "../render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** llama at groq (one offer) and at deepinfra (by its full name), with its keys. */
async function setup(keys: Record<string, string> = {}) {
  const db = new Db("sqlite::memory:");
  const schema = { properties: { ...ai1DbSchema.properties, ...dbSchema.properties } };
  await db.migrate(schema);
  await db.loadTables();
  db.schema = schema;
  await db.table("ai1_provider").insert({ name: "api.groq.com", endpoint: "https://api.groq.com/openai/v1" });
  await db.table("ai1_provider").insert({ name: "api.deepinfra.com", endpoint: "https://api.deepinfra.com/v1/openai" });
  await db.table("ai1_model").insert({ name: "llama-3.3-70b" });
  await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1, provider_model: "llama-3.3-70b-versatile" });
  await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 2, provider_model: "meta-llama/Llama-3.3-70B-Instruct" });
  return { db, t: fakeT, settings: { core: { keys } } } as unknown as App;
}

const MODELS_DEV = {
  groq: { id: "groq", models: { "llama-3.3-70b-versatile": { id: "llama-3.3-70b-versatile", tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 131072 }, cost: { input: 0.59, output: 0.79 } } } },
  deepinfra: { id: "deepinfra", models: { "meta-llama/Llama-3.3-70B-Instruct": { id: "meta-llama/Llama-3.3-70B-Instruct", structured_output: true, modalities: { input: ["text", "image"], output: ["text"] }, cost: { input: 0.1, output: 0.3 } } } },
};
const BENCHMARKS = { data: [{ slug: "llama-3-3-instruct-70b", name: "Llama 3.3 Instruct 70B", evaluations: { artificial_analysis_intelligence_index: 28, artificial_analysis_coding_index: 22, gpqa_diamond: 0.5, note: "text" }, median_output_tokens_per_second: 150, median_time_to_first_token_seconds: 0.4 }] };

async function withSources(fn: () => Promise<void>) {
  const fetchOrg = globalThis.fetch;
  globalThis.fetch = (url) => Promise.resolve(Response.json(String(url).includes("models.dev") ? MODELS_DEV : BENCHMARKS));
  try { await fn(); }
  finally { globalThis.fetch = fetchOrg; }
}

Deno.test("cms.backend.ai1.eval: names match across spellings", () => {
  assertEquals(key("llama-3.3-70b"), key("Llama-3-3-Instruct-70B"));
  assertEquals(key("meta-llama/llama-3.3-70b"), key("llama-3.3-70b"));
  assert(key("llama-3.1-8b") !== key("llama-3.3-70b"));
});

Deno.test("cms.backend.ai1.eval: sources fill prices, capabilities, scores and speed", async () => {
  const app = await setup({ "artificialanalysis.ai": "aa-key" });
  await withSources(async () => {
    assertEquals(await evaluate(app), "models.dev: 2 · Artificial Analysis: 1");
  });
  // each provider its own price, blended 3:1
  assertEquals(await app.db.col`SELECT cost FROM ai1_model_provider ORDER BY id`, [(0.59 * 3 + 0.79) / 4, (0.1 * 3 + 0.3) / 4]);
  // the model gets what either provider knows about it
  assertEquals((await app.db.col`SELECT capability FROM ai1_model_capability ORDER BY capability`), ["object", "text", "tools", "vision"]);
  assertEquals(await app.db.row`SELECT context, bench_speed, bench_ttft FROM ai1_eval_model`, { context: 131072, bench_speed: 150, bench_ttft: 0.4 });
  // every numeric evaluation, one row per area
  assertEquals(await app.db.query`SELECT metric, value FROM ai1_eval_score ORDER BY metric`, [
    { metric: "artificial_analysis_coding_index", value: 22 },
    { metric: "artificial_analysis_intelligence_index", value: 28 },
    { metric: "gpqa_diamond", value: 0.5 },
  ]);
  const out = String(await list({ app } as unknown as Node));
  const at = (name: string) => out.indexOf(`">${name}`);
  assert(at("intelligence") > 0 && at("intelligence") < at("coding") && at("coding") < at("gpqa diamond")); // indexes first
  assertEquals(await app.db.col`SELECT speed FROM ai1_model_provider`, [150, 150]); // nothing measured yet
});

Deno.test("cms.backend.ai1.eval: measured calls beat the benchmark's speed", async () => {
  const app = await setup();
  await app.db.table("ai1_eval_model").insert({ model_id: 1, bench_speed: 150 });
  await record(app, { id: 1, capability: "text", ms: 8_000, output: 800 });
  await record(app, { id: 1, capability: "text", ms: 4_000, output: 400 });
  await record(app, { id: 1, capability: "text", ms: 100, output: 0, error: "HTTP 503" });
  await record(app, { id: 1, capability: "embed", ms: 50, output: 0 });
  assertEquals(await app.db.row`SELECT calls, errors, text_ms, text_output, last_error FROM ai1_eval_stat`, { calls: 4, errors: 1, text_ms: 12_000, text_output: 1200, last_error: "HTTP 503" });
  await applySpeed(app);
  assertEquals(await app.db.col`SELECT speed FROM ai1_model_provider ORDER BY id`, [100, 150]); // 1200 tokens in 12 s; the other not measured

  const out = String(await list({ app } as unknown as Node));
  assert(out.includes("llama-3.3-70b") && out.includes("25 %") && !out.includes("[object Promise]"));
});
