// deno-lint-ignore-file no-explicit-any
import { Db } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import dbSchema from "../dbschema.json" with { type: "json" };
import { AiError, candidates, decide, embed, image, live, speak, structured, text, transcribe, translate } from "../mod.ts";
import { ai1Adapters, ai1Capabilities } from "../plugin.ts";

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

/** `models`: name → its capabilities; without weights the first one comes first. */
async function app(models: Record<string, string[]>, adapters: Record<string, Adapter> = {}) {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  const provider = await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  for (const [name, capabilities] of Object.entries(models)) {
    const id = await db.table("ai1_model").insert({ name });
    await db.table("ai1_model_provider").insert({ model_id: id, provider_id: provider });
    for (const capability of capabilities) await db.table("ai1_model_capability").insert({ model_id: id, capability });
  }
  const mods = [{ name: "ai1", plugin: { ai1Adapters: { ...ai1Adapters, fake, ...adapters }, ai1Capabilities } }];
  return { db, settings: { core: { keys: {} } }, fire: (name: string, e: unknown) => (fired.push([name, e]), Promise.resolve(e)), modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods } } as unknown as App;
}

const fired: [string, any][] = [];
const ask = (content: string) => ({ messages: [{ role: "user" as const, content }] });

Deno.test("ai1: failures fall back and rest", async () => {
  const testApp = await app({ fail: ["text"], low: ["text"] });
  calls.length = 0;
  assertEquals((await text(testApp, ask("hi"))).text, "low: hi");
  assertEquals((await text(testApp, "hi")).text, "low: hi");
  assertEquals(calls, ["fail", "low", "low"]); // the failed one rests
  assertEquals(fired.slice(-3).map(([name, e]) => [name, e.model, e.input, e.output, e.error]), [
    ["ai1:call", "fail", 0, 0, "down"],
    ["ai1:call", "low", 3, 5, undefined],
    ["ai1:call", "low", 3, 5, undefined],
  ]);
});

Deno.test("ai1: one model at several providers, the cheaper or the faster first", async () => {
  const testApp = await app({ llama: ["text"] });
  const second = await testApp.db.table("ai1_provider").insert({ name: "fast", type: "fake", endpoint: "" });
  await testApp.db.exec`UPDATE ai1_model_provider SET cost_input = 1, cost_output = 1, speed = 100, provider_model = 'cheap-llama'`;
  await testApp.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: second, provider_model: "fast-llama", cost_input: 5, cost_output: 5, speed: 900 });
  assertEquals((await text(testApp, ask("hi"), { prefer: { cost: 1 } })).text, "cheap-llama: hi");
  assertEquals((await text(testApp, ask("hi"), { prefer: { speed: 1 } })).text, "fast-llama: hi");
});

Deno.test("ai1: weights choose among models; candidates show the order", async () => {
  const testApp = await app({ smart: ["text"], cheap: ["text"] });
  await testApp.db.exec`UPDATE ai1_model_provider SET cost_input = CASE model_id WHEN 1 THEN 10 ELSE 1 END, cost_output = CASE model_id WHEN 1 THEN 10 ELSE 1 END`;
  await testApp.db.table("ai1_model_score").insert({ model_id: 1, metric: "coding", value: 50 });
  await testApp.db.table("ai1_model_score").insert({ model_id: 2, metric: "coding", value: 20 });
  const first = async (prefer: Record<string, number>) => (await candidates(testApp, "text", ask("hi"), { prefer }))[0].model;
  assertEquals(await first({ coding: 1 }), "smart");
  assertEquals(await first({ cost: 1 }), "cheap");
  assertEquals(await first({ coding: 1, cost: 3 }), "cheap");
  assertEquals(await first({ math: 1 }), "smart"); // unknown everywhere: no difference, then by id
  assertEquals((await text(testApp, ask("hi"), { prefer: { coding: 1 } })).text, "smart: hi"); // request takes the same order
});

Deno.test("ai1: a request too long for a model's context skips it", async () => {
  const testApp = await app({ small: ["text"], big: ["text"] });
  await testApp.db.exec`UPDATE ai1_model SET context_length = 100 WHERE name = 'small'`;
  assertEquals((await text(testApp, "hi")).text, "small: hi");
  assertEquals((await text(testApp, "x".repeat(1000))).text.slice(0, 5), "big: ");
});

Deno.test("ai1: embeddings never fall back to another model", async () => {
  const vectors: Adapter = { embed: (call) => call.model === "a" ? Promise.reject(new AiError("down", 503)) : Promise.resolve([[1]]) };
  const testApp = await app({ a: ["embed"], b: ["embed"] }, { fake: vectors });
  await assertRejects(() => embed(testApp, { texts: ["x"] }), AiError, "down"); // b would give other vectors
  assertEquals(await embed(testApp, { texts: ["x"] }, { model: "b" }), [[1]]); // pinned, it is b's
});

Deno.test("ai1: a pinned model goes first, needs filter the candidates", async () => {
  const testApp = await app({ a: ["text"], b: ["text", "vision"] });
  assertEquals((await text(testApp, ask("hi"), { model: "b" })).text, "b: hi");
  const image = { messages: [{ role: "user" as const, content: [{ type: "image" as const, url: "data:," }, { type: "text" as const, text: "?" }] }] };
  await text(testApp, image);
  assertEquals(calls.at(-1), "b");
});

Deno.test("ai1: capabilities fall back through others", async () => {
  // no translator: translate via text
  assertEquals(await translate(await app({ chat: ["text"] }), { text: "Hallo", to: "en" }), "chat: Hallo");
  // a chat model given translate by hand translates by prompt itself, not the best text model
  assertEquals(await translate(await app({ chat: ["translate"], best: ["text"] }), { text: "Hallo", to: "en" }), "chat: Hallo");
});

Deno.test("ai1: decide via structured via text", async () => {
  let asked = "";
  const judge: Adapter = {
    text: (_call, { messages }) => {
      asked = String(messages[1].content); // after the JSON instruction
      return Promise.resolve({ text: '```json\n{"choice":"no"}\n```', toolCalls: [] });
    },
  };
  const judging = await app({ m: ["text"] }, { fake: judge });
  // a provider without probabilities: all on its choice, and as clear as can be
  const all = { choice: "no", probabilities: { yes: 0, no: 1 }, confidence: 1 };
  assertEquals(await decide(judging, { content: "x", options: ["yes", "no"] }), all);
  assertEquals(await decide(judging, { content: "x", question: "Is it done?" }), all); // no options: yes or no
  assertEquals(asked.includes('["yes","no"]'), true);
  await decide(judging, { content: "x", options: { yes: "It is finished", no: "A draft" } }); // with what each means
  assertEquals(asked.includes('["yes: It is finished","no: A draft"]'), true);
  const liar: Adapter = { text: () => Promise.resolve({ text: '{"choice":"maybe"}', toolCalls: [] }) };
  const lying = await app({ m: ["text"] }, { fake: liar });
  await assertRejects(() => decide(lying, { content: "x", options: ["yes", "no"] }), AiError, "Not an option");
});

Deno.test("ai1: nothing configured, or an answer already streamed, is an error", async () => {
  await assertRejects(async () => text(await app({}), ask("hi")), AiError, 'No model for "text"');
  const testApp = await app({ a: ["text"], b: ["text"] }, { fake: { text: () => Promise.reject(new AiError("cut", undefined, true)) } });
  await assertRejects(() => text(testApp, ask("hi")), AiError, "cut");
});

Deno.test("ai1: openai and deepl adapters speak their protocols", async () => {
  const bodies: any[] = [], extra_content = { google: { thought_signature: "signature-1" } };
  const fetchOrg = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    bodies.push([String(url), init?.body]);
    return Promise.resolve(String(url).endsWith("/translate")
      ? Response.json({ translations: [{ text: "hello" }] })
      : Response.json({ choices: [{ message: { content: "", tool_calls: [{ id: "c1", function: { name: "f", arguments: '{"a":1}' }, extra_content }] } }] }));
  };
  try {
    const testApp = await app({ gpt: ["text", "tools"], deepl: ["translate"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = 'openai', endpoint = 'https://oa.test/v1/'`;
    const dl = await testApp.db.table("ai1_provider").insert({ name: "dl", type: "deepl", endpoint: "https://dl.test/v2" });
    await testApp.db.exec`UPDATE ai1_model_provider SET provider_id = ${dl} WHERE model_id = 2`;

    const tools = [{ name: "f", description: "d", parameters: {} }];
    const first = await text(testApp, { ...ask("hi"), tools });
    assertEquals(first.toolCalls, [{ id: "c1", name: "f", args: { a: 1 }, extra_content }]);
    assertEquals(bodies[0][0], "https://oa.test/v1/chat/completions");
    assertEquals(JSON.parse(bodies[0][1]).tools, [{ type: "function", function: { name: "f", description: "d", parameters: {} } }]);

    assertEquals(await translate(testApp, { text: "Hallo", from: "de", to: "en", format: "html" }), "hello");
    assertEquals(Object.fromEntries(bodies[1][1]), { text: "Hallo", target_lang: "en", source_lang: "de", tag_handling: "html" });

    // a system message amid the history goes as the user's, marked
    await text(testApp, { messages: [{ role: "system", content: "role" }, { role: "user", content: "hi" }, { role: "system", content: "later" }] });
    assertEquals(JSON.parse(bodies[2][1]).messages.map((m: any) => [m.role, m.content]), [["system", "role"], ["user", "hi"], ["user", "<system-reminder>\nlater\n</system-reminder>"]]);
    await text(testApp, { messages: [...ask("hi").messages, { role: "assistant", content: "", toolCalls: first.toolCalls }, { role: "tool", id: "c1", content: "{}" }] });
    assertEquals(JSON.parse(bodies[3][1]).messages[1].tool_calls[0].extra_content, extra_content);
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
async function openaiApp(models: Record<string, string[]>, timeout = 60000) {
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
    { choices: [{ delta: { content: "lo", tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: '{"a"' }, extra_content: { google: { thought_signature: "stream-signature" } } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }, finish_reason: "length" }] },
    { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2 } },
    "[DONE]",
  ), async () => {
    const result = await text(await openaiApp({ gpt: ["text"] }), { ...ask("hi"), onText: (d) => deltas.push(d) });
    assertEquals(deltas, ["Hel", "lo"]);
    assertEquals(result, { text: "Hello", toolCalls: [{ id: "c1", name: "f", args: { a: 1 }, extra_content: { google: { thought_signature: "stream-signature" } } }], truncated: true, model: "gpt", modelProvider: 1 }); // names who answered
    assertEquals([fired.at(-1)![1].input, fired.at(-1)![1].output], [4, 2]); // usage goes to ai1:call
  });
});

Deno.test("ai1: a model that wants alternating roles says what to do", async () => {
  await withFetch(() => new Response("Conversation roles must alternate", { status: 400 }), async () => {
    const testApp = await openaiApp({ gpt: ["text"] }), messages = [{ role: "user" as const, content: "hi" }, { role: "system" as const, content: "later" }];
    await assertRejects(() => text(testApp, { messages }), AiError, "two user messages in a row");
  });
});

Deno.test("ai1: malformed or incomplete streams fail after partial text", async () => {
  const testApp = await openaiApp({ gpt: ["text"] });
  const deltas: string[] = [];
  await withFetch(() => sse({ choices: [{ delta: { content: "partial" } }] }, "not-json"), async () => {
    await assertRejects(() => text(testApp, { ...ask("hi"), onText: (d) => deltas.push(d) }), AiError, "Invalid stream event");
  });
  assertEquals(deltas, ["partial"]);
  assertEquals(fired.at(-1)![1].error, "Invalid stream event");
  await withFetch(() => sse({ choices: [{ delta: { content: "partial" } }] }), async () => {
    await assertRejects(() => text(testApp, { ...ask("hi"), onText: () => {} }), AiError, "Incomplete stream");
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
    const testApp = await openaiApp({ gpt: ["embed", "image", "transcribe"] });
    assertEquals(await embed(testApp, { texts: ["x"] }), [[1, 2]]);
    assertEquals(await image(testApp, { prompt: "cat" }), ["https://img.test/1", "data:image/png;base64,AA=="]);
    assertEquals([fired.at(-1)![1].input, fired.at(-1)![1].output], [3, 2]);
    const transcript = await transcribe(testApp, { file: new File(["x"], "a.mp3") });
    assertEquals(formats, ["verbose_json", null]);
    assertEquals(transcript, { kind: "qino.transcript", version: 1, text: "hi there", language: undefined, segments: [{ text: "hi there" }] });
  });
});

Deno.test("ai1: NVIDIA embeddings distinguish passages from queries", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withFetch((_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ data: [{ embedding: [1, 2] }] });
  }, async () => {
    const testApp = await openaiApp({ embed: ["embed"] });
    await embed(testApp, { texts: ["document"], purpose: "index" });
    await testApp.db.exec`UPDATE ai1_provider SET type = ${"nvidia"}, endpoint = ${"https://integrate.api.nvidia.com/v1"}`;
    await embed(testApp, { texts: ["document"], purpose: "index" });
    await embed(testApp, { texts: ["question"], purpose: "query" });
    await embed(testApp, { texts: ["document"] });
    await testApp.db.close();
  });
  assertEquals(bodies.map((body) => body.input_type), [undefined, "passage", "query", "passage"]);
});

Deno.test("ai1: Jina Omni embeds text and images for retrieval", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withFetch((_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ data: [{ embedding: [1, 2] }] });
  }, async () => {
    const testApp = await openaiApp({ "jina-embeddings-v5-omni-small": ["embed", "vision"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = ${"jina"}, endpoint = ${"https://api.jina.ai/v1"}`;
    await embed(testApp, { texts: ["document"], purpose: "index" });
    await embed(testApp, { texts: ["question"], purpose: "query" });
    await embed(testApp, { images: ["data:image/png;base64,AA=="], purpose: "index" });
    await testApp.db.exec`UPDATE ai1_model SET name = ${"jina-embeddings-v3"}`;
    await embed(testApp, { texts: ["legacy"] });
    await testApp.db.close();
  });
  assertEquals(bodies.map(({ task, input }) => [task, input]), [
    ["retrieval.passage", [{ text: "document" }]],
    ["retrieval.query", [{ text: "question" }]],
    ["retrieval.passage", [{ image: "data:image/png;base64,AA==" }]],
    [undefined, ["legacy"]],
  ]);
});

Deno.test("ai1: google translates", async () => {
  let asked = "";
  await withFetch((url) => (asked = url, Response.json({ data: { translations: [{ translatedText: "hello" }] } })), async () => {
    const testApp = await app({ g: ["translate"] });
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
    const testApp = await openaiApp({ gpt: ["text"] }, 20);
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
  const testApp = await app({ a: ["text"], b: ["text"] });
  calls.length = 0;
  const abort = new AbortController();
  abort.abort();
  await assertRejects(() => text(testApp, ask("hi"), { signal: abort.signal }));
  assertEquals(calls, []);
});

Deno.test("ai1: openrouter decides with Jev (System One)", async () => {
  let body: any;
  await withFetch((url, init) => {
    body = JSON.parse(String(init?.body));
    assertEquals(url, "https://or.test/v1/systemone");
    return Response.json({ answers: { decide: { type: "choice", choice: "billing", probabilities: { technical: 0, billing: 1 }, confidence: 1 } }, usage: { input_tokens: 372, output_tokens: 62 } });
  }, async () => {
    const testApp = await app({ "typesafe/jev-1.13": ["decide"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = 'openrouter', endpoint = 'https://or.test/v1'`;
    const options = { billing: "Payments and invoices", technical: "Something is broken" };
    assertEquals(await decide(testApp, { content: "charged twice", question: "Which team?", options }),
      { choice: "billing", probabilities: { technical: 0, billing: 1 }, confidence: 1 });
    const question = { type: "choice", instructions: "Which team?", criteria: options };
    assertEquals(body, { model: "typesafe/jev-1.13", state: "charged twice", questions: { decide: question } });
  });
});

Deno.test("ai1: without options Jev answers a noul: the probability that it holds", async () => {
  let body: any;
  await withFetch((_url, init) => {
    body = JSON.parse(String(init?.body));
    const answers = { decide: { type: "noul", noul: 0.8 } };
    return Response.json({ answers, usage: { input_tokens: 10, output_tokens: 0 } });
  }, async () => {
    const testApp = await app({ "typesafe/jev-1.13": ["decide"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = 'openrouter', endpoint = 'https://or.test/v1'`;
    const decision = await decide(testApp, { content: "Hallo Welt.", question: "Is the text finished?" });
    const { choice, probabilities } = decision;
    assertEquals([choice, probabilities.yes, probabilities.no.toFixed(2)], ["yes", 0.8, "0.20"]);
    assertEquals(decision.confidence.toFixed(2), "0.28"); // 1 - entropy / log 2
    const criteria = { true: "yes", false: "no" };
    assertEquals(body.questions.decide, { type: "noul", instructions: "Is the text finished?", criteria });
  });
});

Deno.test("ai1: decision protocols use configured endpoints, keys and provider model names", async () => {
  for (const [type, endpoint, path] of [
    ["systemone", "https://decision.test/custom/v1/", "/systemone"],
    ["decisions", "https://decision.test/custom/alpha/", "/decisions"],
  ]) {
    await withFetch((url, init) => {
      assertEquals(url, endpoint.slice(0, -1) + path);
      assertEquals(init?.method, "POST");
      assertEquals(new Headers(init?.headers).get("authorization"), "Bearer test-key");
      assertEquals(new Headers(init?.headers).get("content-type"), "application/json");
      assertEquals(JSON.parse(String(init?.body)), {
        model: "provider-model", state: "Invoice", questions: {
          decide: { type: "choice", instructions: "Classify the input.", criteria: { billing: "billing", support: "support" } },
        },
      });
      return Response.json({ answers: { decide: { choice: "billing", probabilities: { billing: .8, support: .2 } } }, usage: { input_tokens: 12, output_tokens: 0 } });
    }, async () => {
      const testApp = await app({ model: ["decide"] });
      Object.assign(testApp.settings.core.keys, { fake: "test-key" });
      await testApp.db.exec`UPDATE ai1_provider SET type = ${type}, endpoint = ${endpoint}`;
      await testApp.db.exec`UPDATE ai1_model_provider SET provider_model = ${"provider-model"}`;
      const answer = await decide(testApp, { content: "Invoice", options: ["billing", "support"] });
      assertEquals(answer.choice, "billing");
      assertEquals(answer.probabilities, { billing: .8, support: .2 });
      assertEquals(answer.confidence.toFixed(2), "0.28");
      assertEquals([fired.at(-1)![1].input, fired.at(-1)![1].output], [12, 0]);
      await testApp.db.close();
    });
  }
});

Deno.test("ai1: both decision protocols handle yes/no probabilities without a key", async () => {
  for (const type of ["systemone", "decisions"]) {
    let p = 0;
    await withFetch((_url, init) => {
      assertEquals(new Headers(init?.headers).has("authorization"), false);
      assertEquals(JSON.parse(String(init?.body)).questions.decide.type, "noul");
      return Response.json({ answers: { decide: { noul: p } } });
    }, async () => {
      const testApp = await app({ model: ["decide"] });
      await testApp.db.exec`UPDATE ai1_provider SET type = ${type}, endpoint = ${"https://decision.test/v1"}`;
      for (p of [0, .4, .5, 1]) {
        const answer = await decide(testApp, { content: "Test" });
        assertEquals(answer.choice, p >= .5 ? "yes" : "no");
        assertEquals(answer.probabilities, { yes: p, no: 1 - p });
      }
      await testApp.db.close();
    });
  }
});

Deno.test("ai1: malformed native decisions fail instead of inventing certainty", async () => {
  let answer: unknown;
  await withFetch(() => Response.json({ answers: { decide: answer } }), async () => {
    const testApp = await app({ model: ["decide"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = ${"systemone"}, endpoint = ${"https://decision.test/v1"}`;
    for (answer of [{}, { noul: "0.8" }, { noul: -1 }, { noul: 1.1 }]) {
      await assertRejects(() => decide(testApp, { content: "Test" }), AiError, "Invalid probability");
    }
    for (answer of [
      { choice: "billing" },
      { choice: "billing", probabilities: { billing: .8 } },
      { choice: "billing", probabilities: { billing: .8, support: "0.2" } },
      { choice: "billing", probabilities: { billing: .8, support: -.2 } },
      { choice: "billing", probabilities: { billing: .8, other: .2 } },
    ]) {
      await assertRejects(() => decide(testApp, { content: "Test", options: ["billing", "support"] }), AiError, "Invalid probabilities");
    }
    answer = { choice: "toString", probabilities: { billing: 1, support: 0 } };
    await assertRejects(() => decide(testApp, { content: "Test", options: ["billing", "support"] }), AiError, "Not an option");
    await testApp.db.close();
  });
});

Deno.test("ai1: failed decisions fall back and text-only adapters reject images before sending", async () => {
  let count = 0;
  await withFetch(() => {
    count++;
    return count === 1 ? new Response("busy", { status: 503 }) : Response.json({ answers: { decide: { noul: .9 } } });
  }, async () => {
    const testApp = await app({ model: ["decide", "vision"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = ${"systemone"}, endpoint = ${"https://first.test/v1"}`;
    const id = await testApp.db.table("ai1_provider").insert({ name: "second", type: "decisions", endpoint: "https://second.test/v1" });
    await testApp.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: id });
    assertEquals((await decide(testApp, { content: "Test" })).choice, "yes");
    assertEquals(count, 2);
    await assertRejects(() => decide(testApp, { content: [{ type: "image", url: "data:," }] }), AiError, "accepts text only");
    assertEquals(count, 2);
    await testApp.db.close();
  });
});

Deno.test("ai1: translate many texts at once, natively and by prompt", async () => {
  let body: URLSearchParams | undefined;
  await withFetch((_url, init) => (body = init?.body as URLSearchParams, Response.json({ translations: [{ text: "Title" }, { text: "Hello" }] })), async () => {
    const testApp = await app({ dl: ["translate"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = 'deepl', endpoint = 'https://dl.test/v2'`;
    assertEquals(await translate(testApp, { text: ["Titel", "Hallo"], to: "en" }), ["Title", "Hello"]);
    assertEquals(body!.getAll("text"), ["Titel", "Hallo"]);
  });
  assertEquals(await translate(await app({ chat: ["text"] }), { text: ["a", "b"], to: "en" }), ["chat: a", "chat: b"]);
});

Deno.test("ai1: decide on an image needs a vision model; structured takes a JSON Schema too", async () => {
  const answer: Adapter = { structured: (call) => Promise.resolve({ choice: call.model === "seeing" ? "invoice" : "?" }) };
  const image = [{ type: "image" as const, url: "data:," }];
  const withVision = await app({ blind: ["structured"], seeing: ["structured", "vision"] }, { fake: answer });
  assertEquals((await decide(withVision, { content: image, options: ["invoice", "letter"] })).choice, "invoice");
  const json: Adapter = { text: () => Promise.resolve({ text: '{"n":1}', toolCalls: [], truncated: false }) };
  assertEquals(await structured(await app({ m: ["text"] }, { fake: json }), { messages: [{ role: "user", content: "?" }], schema: { type: "object" } }), { n: 1 });
});

Deno.test("ai1: weights see distances — nearly as good and far cheaper wins", async () => {
  const testApp = await app({ top: ["text"], close: ["text"], weak: ["text"] });
  const models = [["top", 50, 10], ["close", 49, 1], ["weak", 20, 0.5]] as const;
  for (const [i, [, coding, cost]] of models.entries()) {
    await testApp.db.exec`UPDATE ai1_model_provider SET cost_input = ${cost}, cost_output = ${cost} WHERE model_id = ${i + 1}`;
    await testApp.db.table("ai1_model_score").insert({ model_id: i + 1, metric: "coding", value: coding });
  }
  const order = async (prefer: Record<string, number>) => (await candidates(testApp, "text", ask("hi"), { prefer })).map((c) => c.model);
  assertEquals(await order({ coding: 1 }), ["top", "close", "weak"]);
  assertEquals(await order({ coding: 1, cost: 1 }), ["close", "top", "weak"]); // by rank all three would tie
});

Deno.test("ai1: a few free or very dear offers don't flatten the prices of the others", async () => {
  // good and fine among 18 weak ones, two of them free and two at $262
  const weak = Array.from({ length: 18 }, (_, i) => [`weak${i}`, 5, i < 2 ? 0 : i < 4 ? 262 : [0.5, 1, 2, 4][i % 4]] as const);
  const models = [["good", 50, 8], ["fine", 45, 2], ...weak] as const;
  const testApp = await app(Object.fromEntries(models.map(([name]) => [name, ["text"]])));
  for (const [i, [, intelligence, cost]] of models.entries()) {
    await testApp.db.exec`UPDATE ai1_model_provider SET cost_input = ${cost}, cost_output = ${cost} WHERE model_id = ${i + 1}`;
    await testApp.db.table("ai1_model_score").insert({ model_id: i + 1, metric: "intelligence", value: intelligence });
  }
  // on the scale from free to $262, $8 and $2 would be nearly the same, and good would win
  assertEquals((await candidates(testApp, "text", ask("hi"))).map((c) => c.model).slice(0, 2), ["fine", "good"]);
});

Deno.test("ai1: openrouter draws at /images", async () => {
  let asked = "";
  await withFetch((url) => (asked = url, Response.json({ data: [{ b64_json: "AA==", media_type: "image/webp" }] })), async () => {
    const testApp = await app({ painter: ["image"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = 'openrouter', endpoint = 'https://or.test/v1'`;
    assertEquals(await image(testApp, { prompt: "cat" }), ["data:image/webp;base64,AA=="]);
    assertEquals([fired.at(-1)![1].input, fired.at(-1)![1].output], [3, 1]);
    assertEquals(asked, "https://or.test/v1/images");
  });
});

Deno.test("ai1: openai speaks at /audio/speech; the audio comes as a data URL", async () => {
  let body: any;
  await withFetch((_url, init) => (body = JSON.parse(String(init?.body)), new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })), async () => {
    const testApp = await openaiApp({ tts: ["speak"] });
    assertEquals(await speak(testApp, { text: "Hallo", voice: "nova" }), "data:audio/mpeg;base64,AQID");
    assertEquals(body, { model: "tts", input: "Hallo", voice: "nova", response_format: "mp3" });
  });
});

Deno.test("ai1: quality, the default, is a capability's own score, else intelligence", async () => {
  const testApp = await app({ smart: ["image"], painter: ["image"] });
  await testApp.db.table("ai1_model_score").insert({ model_id: 1, metric: "intelligence", value: 50 }); // a clever model that draws badly
  await testApp.db.table("ai1_model_score").insert({ model_id: 1, metric: "image", value: 900 });
  await testApp.db.table("ai1_model_score").insert({ model_id: 2, metric: "image", value: 1150 });
  assertEquals((await candidates(testApp, "image", { prompt: "cat" }))[0].model, "painter");
  assertEquals((await candidates(testApp, "image", { prompt: "cat" }, { prefer: { quality: 1 } }))[0].model, "painter"); // quality: the same, by name
  assertEquals((await candidates(testApp, "image", { prompt: "cat" }, { prefer: { intelligence: 1 } }))[0].model, "smart");
  assertEquals((await candidates(testApp, "text", ask("hi"))).length, 0); // (they can't write)
  const writers = await app({ plain: ["text"], clever: ["text"] });
  await writers.db.table("ai1_model_score").insert({ model_id: 2, metric: "intelligence", value: 50 });
  assertEquals((await candidates(writers, "text", ask("hi")))[0].model, "clever");
});

Deno.test("ai1: cache asks openrouter to cache the prompt; unasked, and at openai, nothing is sent", async () => {
  const bodies: any[] = [];
  const answer = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
  await withFetch((_url, init) => (bodies.push(JSON.parse(String(init!.body))), Response.json(answer)), async () => {
    const testApp = await app({ chat: ["text", "structured"] });
    await testApp.db.exec`UPDATE ai1_provider SET type = 'openrouter', endpoint = 'https://or.test/v1'`;
    await text(testApp, { ...ask("hi"), cache: true });
    await text(testApp, ask("hi"));
    await testApp.db.exec`UPDATE ai1_provider SET type = 'openai'`;
    await text(testApp, { ...ask("hi"), cache: true });
    assertEquals(bodies.map((b) => b.cache_control), [{ type: "ephemeral" }, undefined, undefined]);
  });
});

Deno.test("ai1: openai talks live: the offer with the session goes to OpenAI, what is said and tool calls come by its sideband", async () => {
  const posted: [string, RequestInit | undefined][] = [], sent: any[] = [], said: unknown[] = [];
  let socket: any;
  const WebSocketOrg = globalThis.WebSocket;
  globalThis.WebSocket = class {
    url: string; headers: unknown; onmessage?: (e: { data: string }) => void; onclose?: () => void;
    constructor(url: string, options: { headers: unknown }) { this.url = url; this.headers = options.headers; socket = this; }
    send(data: string) { sent.push(JSON.parse(data)); }
    close() { this.onclose?.(); }
  } as any;
  const answer = (sdp: string) => new Response(sdp, { status: 201, headers: { location: "/v1/realtime/calls/rtc_1" } });
  try {
    await withFetch((url, init) => (posted.push([url, init]), url.endsWith("/hangup") ? new Response(null) : answer("answer-sdp")), async () => {
      const testApp = await openaiApp({ voice: ["live"] });
      const call = await live(testApp, {
        sdp: "offer-sdp", instructions: "be kind", tools: [{ name: "clock", description: "The time", parameters: { type: "object" } }],
        onToolCall: (call) => Promise.resolve(`${call.name}: noon`),
        onMessage: (message) => said.push(message),
      });
      assertEquals(call.sdp, "answer-sdp");
      const [url, init] = posted[0], body = init!.body as FormData;
      assertEquals([url, body.get("sdp")], ["https://oa.test/v1/realtime/calls", "offer-sdp"]);
      const session = JSON.parse(String(body.get("session")));
      assertEquals([session.model, session.instructions, session.tools[0].name], ["voice", "be kind", "clock"]);
      assertEquals(socket.url, "wss://oa.test/v1/realtime?call_id=rtc_1");
      const event = (data: unknown) => socket.onmessage({ data: JSON.stringify(data) });
      event({ type: "conversation.item.input_audio_transcription.completed", transcript: "What time is it? " });
      event({ type: "response.done", response: { output: [{ type: "function_call", call_id: "c1", name: "clock", arguments: "{}" }] } });
      event({ type: "response.done", response: { output: [{ type: "message", content: [{ type: "output_audio", transcript: "It is noon." }] }] } });
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(said, [
        { role: "user", content: "What time is it?" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "clock", args: {} }] },
        { role: "tool", id: "c1", content: "clock: noon" },
        { role: "assistant", content: "It is noon." },
      ]);
      assertEquals(sent, [{ type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1", output: "clock: noon" } }, { type: "response.create" }]);
      await call.close();
      assertEquals(posted.at(-1)![0], "https://oa.test/v1/realtime/calls/rtc_1/hangup");
      socket.close();
      await call.done;
    });
  } finally { globalThis.WebSocket = WebSocketOrg; }
});
