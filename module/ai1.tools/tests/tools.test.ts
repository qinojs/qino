// deno-lint-ignore-file no-explicit-any
import { ApiError, App, getCtx } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import { run } from "../mod.ts";

import type { Tool } from "@qino/qino";
import type { Adapter } from "@qino/qino/ai1";

// Asked "a b", the model calls the tools a and b, then answers with their results; asked "loop", it
// never stops calling; asked "stay", it makes model n the better one after its first step; asked
// "provider", it makes the other provider cheaper. It streams what it answers. Whether each call asked
// for the cache goes to `cached`.
let current: App;
const cached: unknown[] = [];
const fake: Adapter = {
  text: (call, { messages, onText, cache }) => {
    cached.push(cache);
    const asked = messages[0].content, last = messages.at(-1);
    if (asked === "stay") {
      if (last.role === "tool") return Promise.resolve({ text: call.model, toolCalls: [], truncated: false });
      return current.db.table("ai1_model_score").insert({ model_id: 2, metric: "intelligence", value: 99 })
        .then(() => ({ text: "", toolCalls: [{ id: "1", name: "echo", args: {} }], truncated: false }));
    }
    if (asked === "provider") {
      if (last.role === "tool") return Promise.resolve({ text: call.provider, toolCalls: [], truncated: false });
      return current.db.exec`UPDATE ai1_model_provider SET cost_input = 10 - cost_input, cost_output = 10 - cost_output`
        .then(() => ({ text: "", toolCalls: [{ id: "1", name: "echo", args: {} }], truncated: false }));
    }
    if (last.role === "tool" && asked !== "loop") {
      const text = messages.filter((m: any) => m.role === "tool").map((m: any) => m.content).join(" ");
      onText?.(text);
      return Promise.resolve({ text, toolCalls: [], truncated: false });
    }
    onText?.("…");
    const names = asked === "loop" ? ["echo"] : asked.split(" ");
    return Promise.resolve({ text: "", toolCalls: names.map((name: string, i: number) => ({ id: `${messages.length}.${i}`, name, args: { name } })), truncated: false });
  },
};

const order: string[] = [];
const tool = (name: string, execute: (args: any) => unknown): Tool =>
  ({ name, description: name, parameters: { type: "object" }, execute: async (args) => (order.push(name), execute(args)) });
const tools = [
  tool("echo", ({ name }) => name),
  tool("who", () => [getCtx().userId, getCtx().statelessAuth]),
  tool("busy", () => { throw new ApiError(409, "busy", { code: "taken" }); }),
  tool("crash", () => { throw new Error("secret"); }),
  tool("huge", () => "x".repeat(200_000)),
];

/** A real app with ai1, the fake model and user 7, for `fn`. */
async function withApp(fn: (app: App) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.modules.add(new URL("../../ai1/plugin.ts", import.meta.url));
  await app.init();
  app.modules.get("ai1")!.plugin.ai1Adapters.fake = fake;
  current = app;
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai1_model").insert({ name: "m" });
    await app.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
    for (const capability of ["text", "tools"]) await app.db.table("ai1_model_capability").insert({ model_id: 1, capability });
    await fn(app);
  } finally {
    delete app.modules.get("ai1")!.plugin.ai1Adapters.fake;
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
}

const ask = (content: string) => ({ messages: [{ role: "user" as const, content }], tools, usrId: 7 });

Deno.test("ai1.tools: runs the tools the model calls, in order, until it answers", () => withApp(async (testApp) => {
  order.length = 0;
  const streamed: string[] = [], came: unknown[] = [];
  const onMessage = (m: any, modelProvider?: number) => came.push([m.role, modelProvider]);
  const out = await run(testApp, { ...ask("echo echo"), onText: (delta) => streamed.push(delta), onMessage });
  assertEquals(out.text, '"echo" "echo"');
  assertEquals(order, ["echo", "echo"]);
  assertEquals(streamed, ["…", '"echo" "echo"']); // every step streams
  assertEquals(out.messages.map((m: any) => [m.role, m.id ?? m.toolCalls?.length]), [["assistant", 2], ["tool", "1.0"], ["tool", "1.1"], ["assistant", 0]]);
  assertEquals(came, [["assistant", 1], ["tool", undefined], ["tool", undefined], ["assistant", 1]]); // each as it comes
}));

Deno.test("ai1.tools: a run stays with the model that answered first, for its prompt cache", () => withApp(async (testApp) => {
  const n = await testApp.db.table("ai1_model").insert({ name: "n" });
  await testApp.db.table("ai1_model_provider").insert({ model_id: n, provider_id: 1 });
  for (const capability of ["text", "tools"]) await testApp.db.table("ai1_model_capability").insert({ model_id: n, capability });
  await testApp.db.table("ai1_model_score").insert({ model_id: 1, metric: "intelligence", value: 10 });
  const out = await run(testApp, ask("stay"));
  assertEquals([out.text, out.model], ["m", "m"]); // n became better, but m kept the run
}));

Deno.test("ai1.tools: a run stays with the provider that answered first", () => withApp(async (testApp) => {
  const other = await testApp.db.table("ai1_provider").insert({ name: "other", type: "fake", endpoint: "" });
  await testApp.db.exec`UPDATE ai1_model_provider SET cost_input = 1, cost_output = 1`;
  await testApp.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: other, cost_input: 9, cost_output: 9 });
  const out = await run(testApp, ask("provider"), { prefer: { cost: 1 } });
  assertEquals([out.text, out.modelProvider], ["fake", 1]); // the other provider became cheaper
}));

Deno.test("ai1.tools: the tools act as the user, not as the caller's request", () => withApp(async (testApp) => {
  assertEquals((await run(testApp, ask("who"))).text, "[7,true]");
  await assertRejects(() => run(testApp, { ...ask("who"), usrId: 0 }), Error, "needs a user");
}));

Deno.test("ai1.tools: failures are told to the model; a server error only as such", () => withApp(async (testApp) => {
  assertEquals((await run(testApp, ask("busy crash nope"))).text,
    '{"error":"busy","code":"taken"} {"error":"Tool failed"} {"error":"Unknown tool: nope"}');
}));

Deno.test("ai1.tools: a result too long is told, not given", () => withApp(async (testApp) => {
  assertEquals((await run(testApp, ask("huge"))).text, '{"error":"Too long: 200002 characters, at most 100000. Ask for less."}');
}));

Deno.test("ai1.tools: the steps are bounded", () => withApp(async (testApp) => {
  order.length = 0;
  await assertRejects(() => run(testApp, { ...ask("loop"), maxSteps: 3 }), Error, "after 3 steps");
  assertEquals(order.length, 3);
}));

Deno.test("ai1.tools: each step asks for the provider's cache, unless told not to", () => withApp(async (testApp) => {
  cached.length = 0;
  await run(testApp, ask("echo"));
  await run(testApp, { ...ask("echo"), cache: false });
  assertEquals(cached, [true, true, false, false]);
}));
