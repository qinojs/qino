// deno-lint-ignore-file no-explicit-any
import { Db } from "@qino/qino";
import { ai1Adapters, ai1DbSchema as dbSchema, ai1Tasks, assert, assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { capabilities, models, providers, widget } from "../render.ts";

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
  await db.migrate(dbSchema);
  await db.loadTables();
  db.schema = dbSchema;
  const mods = [{ name: "ai1", plugin: { ai1Adapters, ai1Tasks } }];
  const app = {
    db, t: fakeT,
    settings: { core: { keys: keys(stored) } },
    modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods },
  } as unknown as App;
  return { app, node: { app } as unknown as Node, stored };
}

Deno.test("cms.backend.ai1: capabilities come from adapters, tasks, needs and use", async () => {
  const { app } = await setup();
  await app.db.table("ai1_model").insert({ name: "m" });
  await app.db.table("ai1_model_capability").insert({ model_id: 1, capability: "summarize" });
  const caps = await capabilities(app);
  for (const c of ["text", "object", "embed", "translate", "decide", "vision", "tools", "summarize"]) assert(caps.includes(c), c);
});

Deno.test("cms.backend.ai1: providers, models, capabilities and keys are managed through the node api", async () => {
  const { app, node, stored } = await setup();
  assertEquals(await api(node, { add: "provider", name: "api.test", type: "openai", endpoint: "https://x.test/v1" }), { ok: true });
  assertEquals(await api(node, { add: "model", name: "llama" }), { ok: true });
  assertEquals(await api(node, { add: "offer", model: 1, provider_id: 1 }), { ok: true });
  assertEquals(await api(node, { set: { table: "ai1_model_provider", id: 1, column: "cost", value: "0.5" } }), { ok: true });
  assertEquals(await api(node, { set: { table: "ai1_model_provider", id: 1, column: "speed", value: "" } }), { ok: true });
  assertEquals(await api(node, { capability: { model: 1, name: "text", priority: "3" } }), { ok: true });
  assertEquals(await api(node, { capability: { model: 1, name: "text", priority: "5" } }), { ok: true });
  assertEquals(await api(node, { key: { provider: "api.test", value: " sk-123456 " } }), { ok: true });
  assertEquals(stored, { "api.test": "sk-123456" });

  assertEquals(await app.db.row`SELECT cost, speed FROM ai1_model_provider`, { cost: 0.5, speed: null });
  assertEquals(await app.db.query`SELECT capability, priority FROM ai1_model_capability`, [{ capability: "text", priority: 5 }]);
  await api(node, { capability: { model: 1, name: "text", priority: "" } });
  assertEquals(await app.db.query`SELECT * FROM ai1_model_capability`, []);

  // only listed columns are writable
  assertEquals((await api(node, { set: { table: "usr", id: 1, column: "email", value: "x" } }) as any).ok, false);
  assertEquals((await api(node, { set: { table: "ai1_model_provider", id: 1, column: "used_input", value: 0 } }) as any).ok, false);
  assertEquals((await api(node, { remove: { table: "usr", id: 1 } }) as any).ok, false);

  assertEquals(await api(node, { remove: { table: "ai1_model", id: 1 } }), { ok: true });
  assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM ai1_model_provider`), 0); // cascades
});

Deno.test("cms.backend.ai1: parts render the matrix and the providers, escaped", async () => {
  const { app, node } = await setup({ "api.test": "sk-abcdef1234", "api.openai.com": "sk-abcdef1234" });
  await api(node, { add: "provider", name: "api.test", type: "openai", endpoint: "https://x.test/v1" });
  await api(node, { add: "model", name: "<b>llama</b>" });
  await api(node, { add: "offer", model: 1, provider_id: 1 });
  await api(node, { capability: { model: 1, name: "text", priority: 7 } });

  const matrix = String(await models(node));
  assertStringIncludes(matrix, "&lt;b&gt;llama&lt;/b&gt;");
  assertStringIncludes(matrix, 'data-capability="text" value="7"');
  assertStringIncludes(matrix, "1 providers");
  assert(!matrix.includes("unusable"));
  await api(node, { capability: { model: 1, name: "vision", priority: 0 } });
  await api(node, { set: { table: "ai1_provider", id: 1, column: "enabled", value: false } });
  const changed = String(await models(node));
  assertStringIncludes(changed, 'type=checkbox data-capability="vision" checked'); // a need, not a priority
  assertStringIncludes(changed, "unusable"); // its only provider is off

  await app.db.exec`UPDATE ai1_provider SET name = 'api.openai.com'`; // a catalog provider: its key link shows
  const list = String(await providers(node));
  assert(!list.includes("[object Promise]") && !matrix.includes("[object Promise]"));
  assertStringIncludes(list, 'title="Get a key"');
  assertStringIncludes(list, "…1234");
  assertStringIncludes(String(await widget(app)), "<b>1</b> models");
});

Deno.test("cms.backend.ai1: try goes through ai1", async () => {
  const { node } = await setup();
  const res = await api(node, { try: { prompt: "hi" } }) as any;
  assertEquals(res.ok, false);
  assertStringIncludes(res.message, 'No model for "text"');
});

Deno.test("cms.backend.ai1: a provider's models are listed and taken over as one model per name", async () => {
  const { app, node } = await setup();
  await api(node, { add: "provider", name: "or", type: "openai", endpoint: "https://or.test/v1" });
  await api(node, { add: "provider", name: "groq", type: "openai", endpoint: "https://groq.test/v1" });
  const fetchOrg = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(Response.json({ data: [{ id: "meta-llama/llama-3.3-70b" }, { id: "gpt-x" }] }));
  try {
    assertEquals(await api(node, { offered: 1 }), { ok: true, list: ["gpt-x", "meta-llama/llama-3.3-70b"], adopted: [] });
  } finally {
    globalThis.fetch = fetchOrg;
  }
  assertEquals(await api(node, { adopt: { provider: 1, id: "meta-llama/llama-3.3-70b" } }), { ok: true });
  assertEquals(await api(node, { adopt: { provider: 2, id: "llama-3.3-70b" } }), { ok: true });
  assertEquals(await api(node, { adopt: { provider: 2, id: "llama-3.3-70b" } }), { ok: true }); // twice is once
  assertEquals(await app.db.query`SELECT name FROM ai1_model`, [{ name: "llama-3.3-70b" }]);
  assertEquals(await app.db.query`SELECT provider_id, provider_model FROM ai1_model_provider ORDER BY id`, [
    { provider_id: 1, provider_model: "meta-llama/llama-3.3-70b" },
    { provider_id: 2, provider_model: "" },
  ]);
  const adopted = await (async () => {
    globalThis.fetch = () => Promise.resolve(Response.json({ data: [] }));
    try { return (await api(node, { offered: 1 }) as any).adopted; }
    finally { globalThis.fetch = fetchOrg; }
  })();
  assertEquals(adopted, ["meta-llama/llama-3.3-70b"]);
});
