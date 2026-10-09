// deno-lint-ignore-file no-explicit-any
import { Db, invoke, Output, requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, fakeT, testContext } from "@qino/qino/tests";
import { AiError } from "@qino/qino/ai";
import { aiCapabilities, dbSchema as aiSchema } from "@qino/m/ai/tests/deps.ts";

import { api } from "../api.ts";

import type { Adapter } from "@qino/qino/ai";

// One model that translates as "<to>:<text>", streams "a", "b", and answers JSON when asked for it;
// asked "hang", it waits on its provider after "a".
const fake: Adapter = {
  translate: (_call, { text, to }) => Promise.resolve(Array.isArray(text) ? text.map((t) => `${to}:${t}`) : `${to}:${text}`),
  text: async (call, { messages, onText }) => {
    onText?.("a");
    if (messages[0]?.content === "hang") await call.fetch("/hang");
    onText?.("b");
    const json = String(messages[0]?.content).startsWith("Reply with JSON");
    return { text: json ? '{"n":1}' : "ab", toolCalls: [], truncated: false };
  },
  image: () => Promise.reject(new AiError("down", 503)),
  embed: (_call, { purpose }) => Promise.resolve([[purpose === "query" ? 1 : 0]]),
};

async function ctx(userId = 1) {
  const db = new Db("sqlite::memory:");
  await db.migrate(aiSchema);
  await db.loadTables();
  await db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  await db.table("ai_model").insert({ name: "m" });
  await db.table("ai_model_provider").insert({ model_id: 1, provider_id: 1 });
  for (const capability of ["text", "translate", "image", "embed"]) await db.table("ai_model_capability").insert({ model_id: 1, capability });
  const mods = [{ name: "ai", plugin: { aiAdapters: { fake }, aiCapabilities } }];
  const modules = { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods };
  return testContext({ app: { db, modules, t: fakeT, settings: { core: { _secret: "test", keys: {} } } } as any, set: { user: userId ? { id: userId } : null, userId } });
}

Deno.test("ai api: capabilities for signed-in users, shaped like their functions", async () => {
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

Deno.test("ai api: text streams deltas, then the answer", async () => {
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
    { done: { text: "ab", toolCalls: [], truncated: false, model: "m", modelProvider: 1 } },
  ]);
});

Deno.test("ai api: a closed stream cancels the call", async () => {
  const signedIn = await ctx();
  let aborted = false;
  const fetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener("abort", () => (aborted = true, reject(init!.signal!.reason))));
  try {
    let output: Output | undefined;
    await requestStorage.run(signedIn, async () => {
      try { await invoke(api, "POST", "/text/stream", { messages: [{ role: "user", content: "hang" }] }); }
      catch (e) { if (e instanceof Output) output = e; else throw e; }
    });
    const reader = (output!.body as ReadableStream).getReader();
    await reader.read(); // "a"
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve));
    assertEquals(aborted, true);
  } finally {
    globalThis.fetch = fetch;
  }
});
