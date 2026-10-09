import { Db } from "@qino/qino";
import { aiDbSchema, assertEquals, assertStringIncludes, Emitter, fakeT } from "@qino/qino/tests";
import { dbSchema as statsSchema, init } from "@qino/m/ai.stats/tests/deps.ts";

import { cms } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai.calls: records failures and shows usage without rendering provider HTML", async () => {
  const db = new Db("sqlite::memory:");
  const combined = { properties: { ...aiDbSchema.properties, ...statsSchema.properties } };
  await db.migrate(combined);
  await db.loadTables();
  db.schema = combined;
  const events = new Emitter<Record<string, any>>();
  const app = { db, t: fakeT, on: events.on.bind(events), fire: events.fire.bind(events) } as unknown as App;
  const stop = new AbortController();
  try {
    await db.table("ai_provider").insert({ name: "<provider>", type: "fake", endpoint: "" });
    await db.table("ai_model").insert({ name: "<model>" });
    const id = Number(await db.table("ai_model_provider").insert({ model_id: 1, provider_id: 1, cost_input: 2, cost_output: 4 }));
    await db.table("ai_model_provider_stat").insert({ model_provider_id: id, calls: 2, errors: 1, used_input: 30, used_output: 5 });
    init(app, { signal: stop.signal });
    await app.fire("ai:call", { id, model: "<model>", provider: "<provider>", capability: "text", ms: 0, input: 0, output: 0, error: "<failed>" });
    await app.fire("ai:call", { id, model: "<model>", provider: "<provider>", capability: "text", ms: 0, input: 0, output: 0 });

    assertEquals(await db.query`SELECT model_provider_id, message FROM ai_call_error`, [{ model_provider_id: id, message: "<failed>" }]);
    const output = String(await cms.node.render({ app } as Node));
    for (const escaped of ["&lt;provider&gt;</span>", "&lt;model&gt;</span>", "<small>&lt;failed&gt;</small>"]) assertStringIncludes(output, escaped);
    assertStringIncludes(output, "30");
    assertStringIncludes(output, "2");
    assertStringIncludes(output, '<progress value="2" max="4"></progress> 2 / 4');
    assertStringIncludes(output, "<td>0.00008");
    await db.table("ai_model_provider").update(id, { cost_output: null });
    assertStringIncludes(String(await cms.node.render({ app } as Node)), "<td>–");
  } finally {
    stop.abort();
    await db.close();
  }
});

Deno.test("cms.backend.ai.calls: empty tables say so", async () => {
  const db = new Db("sqlite::memory:");
  const combined = { properties: { ...aiDbSchema.properties, ...statsSchema.properties } };
  await db.migrate(combined);
  await db.loadTables();
  db.schema = combined;
  const app = { db, t: fakeT } as unknown as App;
  try {
    const output = String(await cms.node.render({ app } as Node));
    assertStringIncludes(output, "<td colspan=6>No calls yet");
    assertStringIncludes(output, "<td colspan=3>No errors yet");
  } finally {
    await db.close();
  }
});
