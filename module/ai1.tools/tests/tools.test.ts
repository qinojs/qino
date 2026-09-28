// deno-lint-ignore-file no-explicit-any
import { ApiError, Db } from "@qino/qino";
import { ai1Adapters, ai1Capabilities, ai1DbSchema, assertEquals, assertRejects } from "@qino/qino/tests";

import { run } from "../mod.ts";

import type { App, Tool } from "@qino/qino";
import type { Adapter } from "@qino/qino/ai1";

// Asked "a b", the model calls the tools a and b, then answers with their results; asked "loop", it
// never stops calling. It streams what it answers.
const fake: Adapter = {
  text: (_call, { messages, onText }) => {
    const asked = messages[0].content, last = messages.at(-1);
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
  tool("busy", () => { throw new ApiError(409, "busy", { code: "taken" }); }),
  tool("crash", () => { throw new Error("secret"); }),
];

async function app(): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(ai1DbSchema);
  await db.loadTables();
  await db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
  await db.table("ai1_model").insert({ name: "m" });
  await db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
  for (const capability of ["text", "tools"]) await db.table("ai1_model_capability").insert({ model_id: 1, capability });
  const mods = [{ name: "ai1", plugin: { ai1Adapters: { ...ai1Adapters, fake }, ai1Capabilities } }];
  return { db, settings: { core: { keys: {} } }, fire: (_: string, e: unknown) => Promise.resolve(e), modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods } } as unknown as App;
}

const ask = (content: string) => ({ messages: [{ role: "user" as const, content }], tools });

Deno.test("ai1.tools: runs the tools the model calls, in order, until it answers", async () => {
  const testApp = await app();
  order.length = 0;
  const streamed: string[] = [];
  const out = await run(testApp, { ...ask("echo echo"), onText: (delta) => streamed.push(delta) });
  assertEquals(out.text, '"echo" "echo"');
  assertEquals(order, ["echo", "echo"]);
  assertEquals(streamed, ["…", '"echo" "echo"']); // every step streams
  assertEquals(out.messages.map((m: any) => [m.role, m.id ?? m.toolCalls?.length]), [["assistant", 2], ["tool", "1.0"], ["tool", "1.1"], ["assistant", 0]]);
});

Deno.test("ai1.tools: failures are told to the model; a server error only as such", async () => {
  const testApp = await app();
  assertEquals((await run(testApp, ask("busy crash nope"))).text,
    '{"error":"busy","code":"taken"} {"error":"Tool failed"} {"error":"Unknown tool: nope"}');
});

Deno.test("ai1.tools: the steps are bounded", async () => {
  const testApp = await app();
  order.length = 0;
  await assertRejects(() => run(testApp, { ...ask("loop"), maxSteps: 3 }), Error, "after 3 steps");
  assertEquals(order.length, 3);
});
