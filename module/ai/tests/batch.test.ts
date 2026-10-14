// deno-lint-ignore-file no-explicit-any
import { Db } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import dbSchema from "../dbschema.json" with { type: "json" };
import { batch } from "../mod.ts";
import { poll } from "../lib/batch.ts";
import { batch as submit, batched, openrouterBatch, openrouterBatched } from "../lib/openai.batch.ts";
import { aiCapabilities } from "../plugin.ts";

import type { App } from "@qino/qino";
import type { Adapter, BatchItem } from "../mod.ts";
import type { Call } from "../lib/request.ts";

// A provider type with a batch API, kept in memory: answers "<model>: <last message>" once `ended`.
const submitted = new Map<string, BatchItem[]>();
let ended = false;
const batching: Adapter = {
  text: () => Promise.reject(new Error("not called directly")),
  batch: (_call, { items }) => (submitted.set("b" + submitted.size, items), Promise.resolve("b" + (submitted.size - 1))),
  batched: (call, { handle }) => Promise.resolve(ended ? (async function* () {
    for (const { id, input } of submitted.get(handle)!.slice(1)) yield { id, output: { text: `${call.model}: ${(input as any).messages.at(-1).content}`, toolCalls: [] }, usage: [3, 5] };
  })() : undefined),
};
// one without: answers directly
const plain: Adapter = { text: (call, { messages }) => Promise.resolve({ text: `${call.model}: ${messages.at(-1).content}`, toolCalls: [] }) };

async function setup(type: string) {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  const provider = await db.table("ai_provider").insert({ name: "fake", type, endpoint: "" });
  const model = await db.table("ai_model").insert({ name: "m" });
  await db.table("ai_model_provider").insert({ model_id: model, provider_id: provider });
  await db.table("ai_model_capability").insert({ model_id: model, capability: "text" });
  const fired: [string, any][] = [];
  const mods = [{ name: "ai", plugin: { aiAdapters: { batching, plain }, aiCapabilities } }];
  const app = { db, settings: { core: { keys: {} } }, fire: (name: string, e: unknown) => (fired.push([name, e]), Promise.resolve(e)), modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods } } as unknown as App;
  return { app, db, fired };
}

const items = ["a", "b", "c"].map((id) => ({ id, input: { messages: [{ role: "user", content: id }] } }));
const answered = (fired: [string, any][]) => fired.filter(([name]) => name === "ai:batched").map(([, e]) => e);

Deno.test("ai: a batch goes to the provider's batch API, its answers come with the next poll after it ended", async () => {
  const { app, db, fired } = await setup("batching");
  await batch(app, "text", { owner: "test", items });
  assertEquals(await db.col`SELECT owner FROM ai_batch`, ["test"]);

  await poll(app); // not ended yet
  assertEquals(answered(fired), []);

  ended = true;
  await poll(app);
  assertEquals(answered(fired), [
    { owner: "test", capability: "text", id: "b", output: { text: "m: b", toolCalls: [], model: "m", modelProvider: 1 } },
    { owner: "test", capability: "text", id: "c", output: { text: "m: c", toolCalls: [], model: "m", modelProvider: 1 } },
    { owner: "test", capability: "text", id: "a", error: "No answer" }, // the provider left it out
  ]);
  assertEquals(fired.find(([name]) => name === "ai:call")![1], { capability: "text", id: 1, model: "m", provider: "fake", ms: 0, input: 3, output: 5, error: undefined, batch: true });
  assertEquals(await db.one`SELECT COUNT(*) FROM ai_batch`, 0); // delivered
  await db.close();
});

Deno.test("ai: without a batch API the calls run one by one in the background, answered the same way", async () => {
  const { app, db, fired } = await setup("plain");
  await batch(app, "text", { owner: "test", items });
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(answered(fired).map((e) => [e.id, e.output.text]), [["a", "m: a"], ["b", "m: b"], ["c", "m: c"]]);
  assertEquals(await db.one`SELECT COUNT(*) FROM ai_batch`, 0);
  await db.close();
});

Deno.test("ai: the OpenAI batch API gets a JSONL file and its answers are read line by line", async () => {
  const requests: [string, string, unknown][] = [];
  const output = [
    { custom_id: "x", response: { status_code: 200, body: { data: [{ embedding: [1, 0] }], usage: { prompt_tokens: 4 } } } },
    { custom_id: "y", response: { status_code: 400, body: { error: { message: "too long" } } } },
  ].map((line) => JSON.stringify(line)).join("\n");
  const call = {
    provider: "fake", model: "e", key: "k", usage: () => {},
    fetch: async (path: string, init: RequestInit = {}) => {
      const body = init.body instanceof FormData ? await (init.body.get("file") as File).text() : init.body ? JSON.parse(String(init.body)) : undefined;
      requests.push([init.method ?? "GET", path, body]);
      const answer = path === "/files" ? { id: "in" } : path === "/batches" ? { id: "batch1" }
        : path === "/batches/batch1" ? { status: "completed", input_file_id: "in", output_file_id: "out" } : undefined;
      return new Response(path === "/files/out/content" ? output : JSON.stringify(answer ?? {}));
    },
  } as unknown as Call;

  assertEquals(await submit(call, { capability: "embed", items: [{ id: "x", input: { texts: ["hi"] } }, { id: "y", input: { texts: ["long"] } }] }), "batch1");
  assertEquals(requests[0][2], [
    { custom_id: "x", method: "POST", url: "/v1/embeddings", body: { model: "e", input: ["hi"] } },
    { custom_id: "y", method: "POST", url: "/v1/embeddings", body: { model: "e", input: ["long"] } },
  ].map((line) => JSON.stringify(line)).join("\n"));
  assertEquals(requests[1].slice(1), ["/batches", { input_file_id: "in", endpoint: "/v1/embeddings", completion_window: "24h" }]);

  const answers = [];
  for await (const answer of (await batched(call, { handle: "batch1", capability: "embed" }))!) answers.push(answer);
  assertEquals(answers, [{ id: "x", output: [[1, 0]], usage: [4] }, { id: "y", error: "too long" }]);
  assertEquals(requests.filter(([method]) => method === "DELETE").map(([, path]) => path), ["/files/out", "/files/in"]); // cleaned up
});

Deno.test("ai: the OpenRouter batch API gets the calls inline, its answers come with the ended batch", async () => {
  const requests: [string, string, unknown][] = [];
  let status = "in_progress";
  const call = {
    provider: "fake", model: "anthropic/claude", key: "k", usage: () => {},
    fetch: (path: string, init: RequestInit = {}) => {
      requests.push([init.method ?? "GET", path, init.body ? JSON.parse(String(init.body)) : undefined]);
      const answer = path === "/batches" ? { id: "b1" } : { status, results: [
        { custom_id: "x", response: { status_code: 200, body: { choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1 } } } },
        { custom_id: "y", error: { message: "no batch endpoint" } },
      ] };
      return Promise.resolve(new Response(JSON.stringify(answer)));
    },
  } as unknown as Call;

  const ask = (content: string) => ({ messages: [{ role: "user", content }] });
  assertEquals(await openrouterBatch(call, { capability: "text", items: [{ id: "x", input: ask("a") }, { id: "y", input: ask("b") }] }), "b1");
  const sent = requests[0][2] as any;
  assertEquals([sent.endpoint, sent.model, Object.keys(sent).at(-1)], ["/v1/chat/completions", "anthropic/claude", "requests"]); // requests last
  assertEquals(sent.requests[0], { custom_id: "x", body: { model: "anthropic/claude", messages: [{ role: "user", content: "a" }] } });

  assertEquals(await openrouterBatched(call, { handle: "b1", capability: "text" }), undefined); // not ended
  status = "completed";
  const answers = [];
  for await (const answer of (await openrouterBatched(call, { handle: "b1", capability: "text" }))!) answers.push(answer);
  assertEquals(answers, [{ id: "x", output: { text: "hi", toolCalls: [], truncated: false }, usage: [2, 1] }, { id: "y", error: "no batch endpoint" }]);
  assertEquals(requests.at(-1)!.slice(0, 2), ["DELETE", "/batches/b1"]); // cleaned up
});
