// deno-lint-ignore-file no-explicit-any
import { Db, invoke, Output, requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { api } from "../api.ts";
import dbSchema from "../dbschema.json" with { type: "json" };
import { AiError } from "../mod.ts";
import { ai1Tasks } from "../plugin.ts";

import type { Adapter } from "../mod.ts";

// One model that translates as "<to>:<text>" and streams "a", "b".
const fake: Adapter = {
  translate: (_call, { text, to }) => Promise.resolve(`${to}:${text}`),
  text: (_call, { onText }) => {
    onText?.("a");
    onText?.("b");
    return Promise.resolve({ text: "ab", toolCalls: [], truncated: false, usage: { input: 1, output: 2 } });
  },
  image: () => Promise.reject(new AiError("down", 503)),
};

async function ctx(userId = 1) {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  await db.table("ai1_model").insert({ name: "m" });
  await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
  for (const capability of ["text", "translate", "image"]) await db.table("ai1_model_capability").insert({ model_id: 1, capability });
  const mods = [{ name: "ai1", plugin: { ai1Adapters: { fake }, ai1Tasks } }];
  const modules = { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods };
  return testContext({ app: { db, modules, settings: { core: { _secret: "test", keys: {} } } } as any, set: { user: userId ? { id: userId } : null } });
}

Deno.test("ai1 api: capabilities for signed-in users, shaped like their functions", async () => {
  const signedIn = await ctx();
  await requestStorage.run(signedIn, async () => {
    assertEquals(await invoke(api, "POST", "/translate", { text: "Hallo", to: "en" }), "en:Hallo");
    await assertRejects(() => invoke(api, "POST", "/image", { prompt: "cat" }), Error, "down"); // upstream failure
    await assertRejects(() => invoke(api, "POST", "/translate", { text: "Hallo", to: "en", extra: 1 })); // strict input
  });
  const anonymous = await ctx(0);
  await requestStorage.run(anonymous, async () => {
    await assertRejects(() => invoke(api, "POST", "/translate", { text: "Hallo", to: "en" }));
  });
});

Deno.test("ai1 api: text streams deltas, then the answer", async () => {
  const signedIn = await ctx();
  let output: Output | undefined;
  await requestStorage.run(signedIn, async () => {
    try { await invoke(api, "POST", "/text/stream", { messages: [{ role: "user", content: "hi" }] }); }
    catch (e) { if (e instanceof Output) output = e; else throw e; }
  });
  const body = await new Response(output!.body as ReadableStream).text();
  assertEquals(body.trim().split("\n\n").map((line) => JSON.parse(line.slice(6))), [
    { delta: "a" },
    { delta: "b" },
    { done: { text: "ab", toolCalls: [], truncated: false, usage: { input: 1, output: 2 } } },
  ]);
});
