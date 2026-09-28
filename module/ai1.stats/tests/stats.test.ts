import { Db } from "@qino/qino";
import { ai1DbSchema, assertEquals, Emitter } from "@qino/qino/tests";

import { applySpeed } from "../mod.ts";
import { dbSchema, fade, init } from "./deps.ts";

import type { App } from "@qino/qino";

async function setup() {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...ai1DbSchema.properties, ...dbSchema.properties } });
  await db.loadTables();
  await db.table("ai1_provider").insert({ name: "p", endpoint: "" });
  for (const name of ["llama", "jev"]) {
    const model = await db.table("ai1_model").insert({ name });
    await db.table("ai1_model_provider").insert({ model_id: model, provider_id: 1 });
  }
  // deno-lint-ignore no-explicit-any
  const events = new Emitter<Record<string, any>>();
  return { db, app: { db, on: events.on.bind(events), fire: events.fire.bind(events) } as unknown as App };
}

Deno.test("ai1.stats: measured calls beat the benchmark's speed, and fade", async () => {
  const { db, app } = await setup();
  const stop = new AbortController();
  init(app, { signal: stop.signal });
  const call = (id: number, ms: number, input: number, output: number, error?: string) => app.fire("ai1:call", { id, capability: "text", ms, input, output, error });
  await db.table("ai1_model_score").insert({ model_id: 1, metric: "tokens_per_second", value: 150 });
  await call(1, 8_000, 10, 800);
  await call(1, 4_000, 10, 400);
  await call(1, 100, 0, 0, "HTTP 503");
  await call(1, 50, 30, 0); // no output tokens (embeddings): not timed
  await call(2, 200, 5, 60); // a quick one (a decision) without a benchmark
  stop.abort();
  assertEquals(await db.query`SELECT model_provider_id, capability, message FROM ai1_call_error`, [{ model_provider_id: 1, capability: "text", message: "HTTP 503" }]);
  await applySpeed(app);
  assertEquals(await db.col`SELECT speed FROM ai1_model_provider ORDER BY id`, [100, 300]); // 1200 tokens in 12 s; 60 in 0.2 s
  await fade(app);
  assertEquals(await db.row`SELECT calls, errors, ms, output, used_input, used_output FROM ai1_model_provider_stat WHERE model_provider_id = 1`,
    { calls: 2, errors: 0, ms: 6_000, output: 600, used_input: 50, used_output: 1200 }); // the usage stays a total
  await db.exec`UPDATE ai1_model_provider_stat SET ms = 1_000 WHERE model_provider_id = 1`; // too little measured: the benchmark's
  await applySpeed(app);
  assertEquals(await db.col`SELECT speed FROM ai1_model_provider ORDER BY id`, [150, 300]);
  await db.close();
});
