// deno-lint-ignore-file no-explicit-any
import { App, sql } from "@qino/qino";
import { assertEquals, assertRejects, assertStringIncludes } from "@qino/qino/tests";

import { collections, create, drop } from "@qino/qino/ai1.embed";

import { Agent, Session } from "../mod.ts";

import type { Adapter } from "@qino/qino/ai1";

// Answers with its role, how many questions it has seen and the last one; asked "time?", it calls
// the tool now first; "remember:fact", "replace:id:fact", "forget:id" and "search:query" go to those
// tools; "slow" takes a moment; "fail" fails. It embeds what mentions a logo apart from the rest.
const fake: Adapter = {
  embed: (_call, { texts }) => Promise.resolve(texts.map((t: string) => t.includes("logo") ? [1, 0] : [0, 1])),
  text: async (_call, { messages }) => {
    const last = messages.at(-1), asked = messages.filter((m: any) => m.role === "user");
    if (last.content === "fail") throw new Error("down");
    if (last.content === "time?") return { text: "", toolCalls: [{ id: "1", name: "now", args: {} }], truncated: false };
    const [verb, a, b] = String(last.content).split(":");
    const args = verb === "remember" ? { content: a } : verb === "replace" ? { content: b, replaces: Number(a) } : verb === "search" ? { query: a } : { id: Number(a) };
    if (last.role === "user" && a) return { text: "", toolCalls: [{ id: "1", name: verb === "replace" ? "remember" : verb, args }], truncated: false };
    if (last.content === "slow") await new Promise((r) => setTimeout(r, 30));
    const result = last.role === "tool" && JSON.parse(last.content);
    const said = last.role === "tool" ? `it is ${typeof result === "string" ? result : JSON.stringify(result)}` : last.content;
    return { text: `${messages[0].content} #${asked.length} ${said}`, toolCalls: [], truncated: false };
  },
};

async function withApp(fn: (app: App) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["../../ai1/plugin.ts", "../../ai1.tools/plugin.ts", "../../cron/plugin.ts", "../../score/plugin.ts", "../../ai1.embed/plugin.ts", "../plugin.ts", "./toolset/plugin.ts"]) app.modules.add(new URL(mod, import.meta.url));
  await app.init();
  app.modules.get("ai1")!.plugin.ai1Adapters.fake = fake;
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("usr").insert({ id: 8, username: "bob@example.test", active: true });
    await app.db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai1_model").insert({ name: "m" });
    await app.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
    for (const capability of ["text", "tools", "embed"]) await app.db.table("ai1_model_capability").insert({ model_id: 1, capability });
    for (const { id } of await collections(app)) await drop(app, id);
    await create(app, "m", 2);
    await fn(app);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later, embeddings run in the background
    delete app.modules.get("ai1")!.plugin.ai1Adapters.fake;
    await app.db.close();
  }
}

const kept = async (app: App, session: number) =>
  (await app.db.query`SELECT message, model FROM ai1_session_message WHERE session_id = ${session} ORDER BY id`)
    .map((row) => { const m = JSON.parse(String(row.message)); return [m.role, m.content || m.toolCalls?.[0]?.name, row.model]; });

Deno.test("ai1.agent: a session goes on from what was said, with the agent's role and tools, and keeps it all", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead", tools: ["clock"] });
  const session = await agent.start(7);
  assertEquals((await session.ask("hi")).text, "lead #1 hi");
  assertEquals((await session.ask("time?")).text, "lead #2 it is noon");
  assertEquals(await kept(app, session.id), [
    ["user", "hi", ""], ["assistant", "lead #1 hi", "m"],
    ["user", "time?", ""], ["assistant", "now", ""], ["tool", '"noon"', ""], ["assistant", "lead #2 it is noon", "m"],
  ]);
  assertEquals((await (await agent.start(7)).ask("hi")).text, "lead #1 hi"); // a new session starts fresh
}));

Deno.test("ai1.agent: memories outlast the session and are shared by all who talk with the agent", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead" });
  assertEquals((await (await agent.start(7)).ask("remember:blue")).text, 'lead #1 it is {"id":1}');
  const bob = await agent.start(8);
  assertEquals((await bob.ask("hi")).text, "lead\n\nYour memories:\n[1] blue #1 hi"); // in the context
  await bob.ask("replace:1:red");
  assertStringIncludes((await bob.ask("hi")).text, "[1] red #");
  await bob.ask("forget:1");
  assertEquals([await app.db.one`SELECT COUNT(*) FROM ai1_agent_memory`, await app.db.one`SELECT COUNT(*) FROM score`], [0, 0]); // its strength goes too
  assertStringIncludes((await bob.ask("forget:1")).text, '"error":"No such memory"'); // told to the model
}));

Deno.test("ai1.agent: memories renewed come first, the rest fades", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  for (const fact of ["apple", "zebra"]) await session.ask(`remember:${fact}`);
  for (let i = 0; i < 3; i++) await session.ask("replace:2:zebra");
  assertStringIncludes((await session.ask("hi")).text, "[2] zebra\n[1] apple");
}));

/** Until the background has embedded `count` rows of `table`. */
async function embedded(app: App, table: string, count: number) {
  for (let i = 0; i < 100 && Number(await app.db.one`SELECT COUNT(*) FROM ${sql.id(table)}`) < count; i++) await new Promise((r) => setTimeout(r, 10));
}

Deno.test("ai1.agent: it finds by meaning what was said in any of its sessions, and its memories", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead" });
  await (await agent.start(7)).ask("the logo is round");
  await (await agent.start(7)).ask("remember:the logo is blue");
  await embedded(app, "embedding_ai1_session_message", 2);
  await embedded(app, "embedding_ai1_agent_memory", 1);
  const found = (await (await agent.start(8)).ask("search:logo")).text;
  for (const part of ['{"memory":1,"text":"the logo is blue"}', '"text":"the logo is round"']) assertStringIncludes(found, part);
}));

Deno.test("ai1.agent: a failure is kept, but not sent again", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  await assertRejects(() => session.ask("fail"), Error, "down");
  assertEquals((await session.ask("hi")).text, "lead #2 hi");
  assertEquals((await kept(app, session.id)).map(([role]) => role), ["user", "error", "user", "assistant"]);
}));

Deno.test("ai1.agent: one turn after the other in a session", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  const [first, second] = await Promise.all([session.ask("slow"), new Session(app, session.id).ask("then")]); // another handle, the same session
  assertEquals([first.text, second.text], ["lead #1 slow", "lead #2 then"]); // the second saw the first
}));
