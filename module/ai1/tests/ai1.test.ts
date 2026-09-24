// deno-lint-ignore-file no-explicit-any
import { Db } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import dbSchema from "../dbschema.json" with { type: "json" };
import { AiError, decide, embed, image, text, transcribe, translate } from "../mod.ts";
import { ai1Adapters, ai1Tasks } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Adapter } from "../mod.ts";

// A fake provider type answers "<model>: <last message>"; models named "fail*" throw.
const calls: string[] = [];
const fake: Adapter = {
  text: (call, { messages }) => {
    calls.push(call.model);
    if (call.model.startsWith("fail")) return Promise.reject(new AiError("down", 503));
    call.usage(3, 5);
    return Promise.resolve({ text: `${call.model}: ${messages.at(-1).content}`, toolCalls: [] });
  },
};

/** `models`: name → { capability: priority } */
async function app(models: Record<string, Record<string, number>>, adapters: Record<string, Adapter> = {}): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  const provider = await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  for (const [name, capabilities] of Object.entries(models)) {
    const id = await db.table("ai1_model").insert({ name });
    await db.table("ai1_model_provider").insert({ model_id: id, provider_id: provider });
    for (const [capability, priority] of Object.entries(capabilities)) await db.table("ai1_model_capability").insert({ model_id: id, capability, priority });
  }
  const mods = [{ name: "ai1", plugin: { ai1Adapters: { ...ai1Adapters, fake, ...adapters }, ai1Tasks } }];
  return { db, settings: { core: { keys: {} } }, modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods } } as unknown as App;
}

const ask = (content: string) => ({ messages: [{ role: "user" as const, content }] });

Deno.test("ai1: highest priority first, failures fall back and rest", async () => {
  const testApp = await app({ low: { text: 1 }, fail: { text: 9 } });
  calls.length = 0;
  assertEquals((await text(testApp, ask("hi"))).text, "low: hi");
  assertEquals((await text(testApp, "hi")).text, "low: hi");
  assertEquals(calls, ["fail", "low", "low"]); // the failed one rests
  assertEquals(await testApp.db.row`SELECT used_input, used_output FROM ai1_model_provider WHERE model_id = 1`, { used_input: 6, used_output: 10 });
});

Deno.test("ai1: one model at several providers, the cheaper or the faster first", async () => {
  const testApp = await app({ llama: { text: 0 } });
  const second = await testApp.db.table("ai1_provider").insert({ name: "fast", type: "fake", endpoint: "" });
  await testApp.db.exec`UPDATE ai1_model_provider SET cost = 1, speed = 100, provider_model = 'cheap-llama'`;
  await testApp.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: second, provider_model: "fast-llama", cost: 5, speed: 900 });
  assertEquals((await text(testApp, ask("hi"))).text, "cheap-llama: hi");
  assertEquals((await text(testApp, ask("hi"), { prefer: "speed" })).text, "fast-llama: hi");
});

Deno.test("ai1: a pinned model goes first, needs filter the candidates", async () => {
  const testApp = await app({ a: { text: 2 }, b: { text: 1, vision: 0 } });
  assertEquals((await text(testApp, ask("hi"), { model: "b" })).text, "b: hi");
  const image = { messages: [{ role: "user" as const, content: [{ type: "image" as const, url: "data:," }, { type: "text" as const, text: "?" }] }] };
  await text(testApp, image);
  assertEquals(calls.at(-1), "b");
});

Deno.test("ai1: capabilities fall back through others", async () => {
  // no translator: translate via text
  assertEquals(await translate(await app({ chat: { text: 0 } }), { text: "Hallo", to: "en" }), "chat: Hallo");
  // a chat model given translate by hand translates by prompt itself, not the best text model
  assertEquals(await translate(await app({ chat: { translate: 2 }, best: { text: 9 } }), { text: "Hallo", to: "en" }), "chat: Hallo");
});

Deno.test("ai1: decide via object via text", async () => {
  const judge: Adapter = { text: () => Promise.resolve({ text: '```json\n{"choice":"no"}\n```', toolCalls: [] }) };
  assertEquals(await decide(await app({ m: { text: 0 } }, { fake: judge }), { text: "x", options: ["yes", "no"] }), { choice: "no" });
  const liar: Adapter = { text: () => Promise.resolve({ text: '{"choice":"maybe"}', toolCalls: [] }) };
  const lying = await app({ m: { text: 0 } }, { fake: liar });
  await assertRejects(() => decide(lying, { text: "x", options: ["yes", "no"] }), AiError, "Not an option");
});

Deno.test("ai1: nothing configured, or an answer already streamed, is an error", async () => {
  await assertRejects(async () => text(await app({}), ask("hi")), AiError, 'No model for "text"');
  const testApp = await app({ a: { text: 2 }, b: { text: 1 } }, { fake: { text: () => Promise.reject(new AiError("cut", undefined, true)) } });
  await assertRejects(() => text(testApp, ask("hi")), AiError, "cut");
});

Deno.test("ai1: openai and deepl adapters speak their protocols", async () => {
  const bodies: any[] = [];
  const fetchOrg = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    bodies.push([String(url), init?.body]);
    return Promise.resolve(String(url).endsWith("/translate")
      ? Response.json({ translations: [{ text: "hello" }] })
      : Response.json({ choices: [{ message: { content: "", tool_calls: [{ id: "c1", function: { name: "f", arguments: '{"a":1}' } }] } }] }));
  };
  try {
    const testApp = await app({ gpt: { text: 0, tools: 0 }, deepl: { translate: 0 } });
    await testApp.db.exec`UPDATE ai1_provider SET type = 'openai', endpoint = 'https://oa.test/v1/'`;
    const dl = await testApp.db.table("ai1_provider").insert({ name: "dl", type: "deepl", endpoint: "https://dl.test/v2" });
    await testApp.db.exec`UPDATE ai1_model_provider SET provider_id = ${dl} WHERE model_id = 2`;

    const tools = [{ name: "f", description: "d", parameters: {} }];
    assertEquals((await text(testApp, { ...ask("hi"), tools })).toolCalls, [{ id: "c1", name: "f", args: { a: 1 } }]);
    assertEquals(bodies[0][0], "https://oa.test/v1/chat/completions");
    assertEquals(JSON.parse(bodies[0][1]).tools, [{ type: "function", function: { name: "f", description: "d", parameters: {} } }]);

    assertEquals(await translate(testApp, { text: "Hallo", from: "de", to: "en", format: "html" }), "hello");
    assertEquals(Object.fromEntries(bodies[1][1]), { text: "Hallo", target_lang: "en", source_lang: "de", tag_handling: "html" });
  } finally {
    globalThis.fetch = fetchOrg;
  }
});

/** Replace fetch for `fn`; `handler` answers by url. */
async function withFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, fn: () => Promise<void>) {
  const fetchOrg = globalThis.fetch;
  globalThis.fetch = (url, init) => Promise.resolve(handler(String(url), init));
  try { await fn(); }
  finally { globalThis.fetch = fetchOrg; }
}

/** An app whose models all run at one openai-type provider. */
async function openaiApp(models: Record<string, Record<string, number>>, timeout = 60000): Promise<App> {
  const testApp = await app(models);
  await testApp.db.exec`UPDATE ai1_provider SET type = 'openai', endpoint = 'https://oa.test/v1', timeout_ms = ${timeout}`;
  return testApp;
}

const sse = (...events: unknown[]) => new Response(new ReadableStream({
  start(out) {
    for (const event of events) out.enqueue(new TextEncoder().encode(`data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`));
    out.close();
  },
}));

Deno.test("ai1: openai streams text, joins tool-call fragments, reports truncation and usage", async () => {
  const deltas: string[] = [];
  await withFetch(() => sse(
    { choices: [{ delta: { content: "Hel" } }] },
    { choices: [{ delta: { content: "lo", tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: '{"a"' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }, finish_reason: "length" }] },
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2 } },
    "[DONE]",
  ), async () => {
    const result = await text(await openaiApp({ gpt: { text: 0 } }), { ...ask("hi"), onText: (d) => deltas.push(d) });
    assertEquals(deltas, ["Hel", "lo"]);
    assertEquals(result, { text: "Hello", toolCalls: [{ id: "c1", name: "f", args: { a: 1 } }], truncated: true, usage: { input: 4, output: 2 } });
  });
});

Deno.test("ai1: openai embeds, draws images, transcribes (retrying without verbose_json)", async () => {
  const formats: unknown[] = [];
  await withFetch((url, init) => {
    if (url.endsWith("/embeddings")) return Response.json({ data: [{ embedding: [1, 2] }], usage: { prompt_tokens: 3 } });
    if (url.endsWith("/images/generations")) return Response.json({ data: [{ url: "https://img.test/1" }, { b64_json: "AA==" }] });
    const format = (init?.body as FormData).get("response_format");
    formats.push(format);
    return format ? new Response("unsupported", { status: 400 }) : Response.json({ text: "hi there" });
  }, async () => {
    const testApp = await openaiApp({ gpt: { embed: 0, image: 0, transcribe: 0 } });
    assertEquals(await embed(testApp, { texts: ["x"] }), [[1, 2]]);
    assertEquals(await image(testApp, { prompt: "cat" }), ["https://img.test/1", "data:image/png;base64,AA=="]);
    const transcript = await transcribe(testApp, { file: new File(["x"], "a.mp3") });
    assertEquals(formats, ["verbose_json", null]);
    assertEquals(transcript, { kind: "qino.transcript", version: 1, text: "hi there", language: undefined, segments: [{ text: "hi there" }] });
  });
});

Deno.test("ai1: google translates", async () => {
  let asked = "";
  await withFetch((url) => (asked = url, Response.json({ data: { translations: [{ translatedText: "hello" }] } })), async () => {
    const testApp = await app({ g: { translate: 0 } });
    await testApp.db.exec`UPDATE ai1_provider SET type = 'google', endpoint = 'https://gt.test/v2'`;
    assertEquals(await translate(testApp, { text: "Hallo", from: "de", to: "en" }), "hello");
    assertEquals(Object.fromEntries(new URL(asked).searchParams), { q: "Hallo", target: "en", format: "text", source: "de", key: "" });
  });
});

Deno.test("ai1: silence times out and rests the provider until the cooldown is over", async () => {
  let calls = 0;
  const hang = (_url: string, init?: RequestInit) => {
    calls++;
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  };
  await withFetch(hang, async () => {
    const testApp = await openaiApp({ gpt: { text: 0 } }, 20);
    await assertRejects(() => text(testApp, ask("hi")), AiError, "No answer for 0.02s");
    await assertRejects(() => text(testApp, ask("hi")), AiError, 'No model for "text"'); // resting
    assertEquals(calls, 1);
    const now = Date.now;
    Date.now = () => now() + 61_000;
    try { await assertRejects(() => text(testApp, ask("hi")), AiError, "No answer"); }
    finally { Date.now = now; }
    assertEquals(calls, 2);
  });
});

Deno.test("ai1: a cancelled call does not fall back", async () => {
  const testApp = await app({ a: { text: 2 }, b: { text: 1 } });
  calls.length = 0;
  const abort = new AbortController();
  abort.abort();
  await assertRejects(() => text(testApp, ask("hi"), { signal: abort.signal }));
  assertEquals(calls, []);
});
