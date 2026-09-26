// deno-lint-ignore-file no-explicit-any
import { Db, invoke, Output, requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, fakeT, testContext } from "@qino/qino/tests";

import { api } from "../api.ts";
import dbSchema from "../dbschema.json" with { type: "json" };
import { AiError } from "../mod.ts";
import { check, count } from "../lib/limit.ts";
import { ai1Capabilities } from "../plugin.ts";

import type { Adapter } from "../mod.ts";

// One model that translates as "<to>:<text>", streams "a", "b", and answers JSON when asked for it.
const fake: Adapter = {
  translate: (_call, { text, to }) => Promise.resolve(Array.isArray(text) ? text.map((t) => `${to}:${t}`) : `${to}:${text}`),
  text: (_call, { messages, onText }) => {
    onText?.("a");
    onText?.("b");
    const json = String(messages[0]?.content).startsWith("Reply with JSON");
    return Promise.resolve({ text: json ? '{"n":1}' : "ab", toolCalls: [], truncated: false });
  },
  image: () => Promise.reject(new AiError("down", 503)),
  embed: (_call, { purpose }) => Promise.resolve([[purpose === "query" ? 1 : 0]]),
};

async function ctx(userId = 1, dailyLimit = 0) {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  await db.table("ai1_model").insert({ name: "m" });
  await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
  for (const capability of ["text", "translate", "image", "embed"]) await db.table("ai1_model_capability").insert({ model_id: 1, capability });
  const mods = [{ name: "ai1", plugin: { ai1Adapters: { fake }, ai1Capabilities } }];
  const modules = { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods };
  return testContext({ app: { db, modules, t: fakeT, settings: { core: { _secret: "test", keys: {} }, ai1: { dailyLimit } } } as any, set: { user: userId ? { id: userId } : null, userId } });
}

Deno.test("ai1 api: capabilities for signed-in users, shaped like their functions", async () => {
  const signedIn = await ctx();
  await requestStorage.run(signedIn, async () => {
    assertEquals(await invoke(api, "POST", "/translate", { text: "Hallo", to: "en" }), "en:Hallo");
    assertEquals(await invoke(api, "POST", "/translate", { text: ["a", "b"], to: "en" }), ["en:a", "en:b"]);
    assertEquals(await invoke(api, "POST", "/structured", { messages: [{ role: "user", content: "?" }], schema: { type: "object" } }), { n: 1 }); // via text
    assertEquals(await invoke(api, "POST", "/embed", { texts: ["?"], purpose: "query" }), [[1]]);
    await assertRejects(() => invoke(api, "POST", "/embed", { texts: ["?"], purpose: "other" }), Error, "purpose");
    await assertRejects(() => invoke(api, "POST", "/translate", { text: 5, to: "en" }), Error, "a string or strings");
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
    { done: { text: "ab", toolCalls: [], truncated: false } },
  ]);
});

Deno.test("ai1 api: a user's usage counts per day; over the limit the browser API refuses", async () => {
  const signedIn = await ctx(1, 10);
  const app = signedIn.app;
  await requestStorage.run(signedIn, async () => {
    await count(app, { input: 4, output: 4 });
    await check(signedIn); // 8 of 10
    await count(app, { input: 1, output: 2 });
    await assertRejects(() => check(signedIn), Error, "limit");
    await assertRejects(() => invoke(api, "POST", "/translate", { text: "Hallo", to: "en" }), Error, "limit");
  });
  await count(app, { input: 5, output: 5 }); // no request, no user: not counted
  assertEquals(Number(await app.db.one`SELECT units FROM ai1_usage WHERE usr_id = 1`), 11);
  await app.db.exec`UPDATE ai1_usage SET day = day - 1`; // a new day starts at zero
  await requestStorage.run(signedIn, () => check(signedIn));
});
