// deno-lint-ignore-file no-explicit-any
import { App, runAs, sql } from "@qino/qino";
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@qino/qino/tests";

import { AiError } from "@qino/qino/ai1";
import { collections, create, drop } from "@qino/qino/ai1.embed";

import { hit } from "@qino/qino/score";

import { HINT, index } from "../lib/memory.ts";
import { keep } from "../lib/search.ts";
import { situation } from "../lib/turn.ts";
import { Agent, Session } from "../mod.ts";

import type { Adapter } from "@qino/qino/ai1";

// Answers with its role, how many questions it has seen and the last one; asked "time?", it calls
// the tool now first; "remember:fact", "replace:id:fact", "forget:id" and "search:query" go to those
// tools, "find:what" and "call:tool" to finding and calling more; "slow" takes a moment; "hang" never answers; "fail" fails, "break" after streaming a part. It embeds what mentions a logo apart from the rest.
// What it is sent goes to `sent`.
const sent: unknown[][] = [];
// the situation, the role header, the standing hint and an empty memories header are left out of what the fake echoes
const shown = (system: string) => system.replace(/^[^]*?## Your role\n/, "").replace(`\n${HINT}`, "").replace(/\n\n## Your memories(?!\n)/, "");

const fake: Adapter = {
  embed: (_call, { texts }) => Promise.resolve(texts.map((t: string) => t.includes("logo") ? [1, 0] : [0, 1])),
  text: async (_call, { messages, onText }) => {
    sent.push(messages);
    // as the providers: every tool call needs its result
    const results = new Set(messages.filter((m: any) => m.role === "tool").map((m: any) => m.id));
    const open = messages.flatMap((m: any) => m.toolCalls ?? []).find((c: any) => !results.has(c.id));
    if (open) throw new Error(`No tool output found for function call ${open.id}`);
    const last = messages.at(-1), asked = messages.filter((m: any) => m.role === "user");
    const typed = String(last.content).split("\n\n(internal")[0]; // without the memories it brought to mind
    if (typed === "fail") throw new Error("down");
    if (typed === "break") throw (onText?.("so far"), new AiError("broken", 502, true));
    if (typed === "time?") return { text: "", toolCalls: [{ id: "1", name: "toolset_clock_get", args: {} }], truncated: false };
    const [verb, a, b] = typed.split(":");
    const call = { remember: ["memories_post", { content: a }], replace: ["memories_post", { content: b, replaces: Number(a) }], forget: ["memories_delete", { memory: Number(a) }], search: ["search_post", { query: a }],
      find: ["find_tools", { search: a }], call: ["core_toolCalls_post", { calls: [{ name: a }] }] }[verb];
    if (last.role === "user" && call) return { text: "", toolCalls: [{ id: "1", name: call[0], args: call[1] }], truncated: false };
    if (typed === "slow") await new Promise((r) => setTimeout(r, 30));
    if (typed === "hang") await new Promise(() => {}); // deaf to the signal too
    const result = last.role === "tool" && JSON.parse(last.content);
    const said = last.role === "tool" ? `it is ${typeof result === "string" ? result : JSON.stringify(result)}` : last.content;
    return { text: `${shown(messages[0].content)} #${asked.length} ${said}`, toolCalls: [], truncated: false };
  },
};

async function withApp(fn: (app: App) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["../../ai1/plugin.ts", "../../ai1.tools/plugin.ts", "../../cron/plugin.ts", "../../score/plugin.ts", "../../ai1.embed/plugin.ts", "../../ai1.discover/plugin.ts", "../plugin.ts", "./toolset/plugin.ts", "./many/plugin.ts"]) app.modules.add(new URL(mod, import.meta.url));
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

/** What the session kept: per message its role, what it says, and the model at its provider that answered. */
const kept = async (app: App, session: number) =>
  (await app.db.query`SELECT m.message, am.name AS model FROM ai1_session_message m
    LEFT JOIN ai1_model_provider mp ON mp.id = m.model_provider_id LEFT JOIN ai1_model am ON am.id = mp.model_id
    WHERE m.session_id = ${session} ORDER BY m.id`)
    .map((row) => {
      const m = JSON.parse(String(row.message));
      return [m.role, m.content || m.toolCalls?.[0]?.name, row.model ?? ""];
    });

Deno.test("ai1.agent: a session goes on from what was said, with the agent's role and tools, and keeps it all", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead", tools: ["toolset_*"] });
  const session = await agent.start(7);
  assertEquals((await session.ask("hi")).text, "lead #1 hi");
  assertEquals((await session.ask("time?")).text, "lead #2 it is noon");
  assertEquals(await kept(app, session.id), [
    ["system", `${situation(agent.id, session.id, await app.url())}\n\n## Your role\nlead\n\n## Your memories\n${HINT}`, ""], // what the model is given, once while it does not change
    ["user", "hi", ""], ["assistant", "lead #1 hi", "m"],
    ["user", "time?", ""], ["assistant", "toolset_clock_get", "m"], ["tool", '"noon"', ""], ["assistant", "lead #2 it is noon", "m"],
  ]);
  const answered = await app.db.col`SELECT model_provider_id FROM ai1_session_message
    WHERE session_id = ${session.id} AND model_provider_id IS NOT NULL`;
  assertEquals(answered.map(Number), [1, 1, 1]); // each answer: the model at its provider that gave it
  assertEquals((await (await agent.start(7)).ask("hi")).text, "lead #1 hi"); // a new session starts fresh
}));

Deno.test("ai1.agent: a turn that failed amid its tool calls doesn't block the session", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead", tools: ["toolset_*"] });
  const session = await agent.start(7);
  await session.ask("hi");
  // the call kept, its result not: the turn failed in between
  await app.db.table("ai1_session_message").insert({ session_id: session.id, message: JSON.stringify({ role: "assistant", content: "", toolCalls: [{ id: "x", name: "toolset_clock_get", args: {} }] }) });
  assertEquals((await session.ask("and now?")).text, "lead #2 and now?");
  const told = (sent.at(-1) as any[]).find((m) => m.role === "tool");
  assertEquals([told.id, told.content], ["x", '{"error":"No result: the turn failed"}']); // only sent, not kept
}));

Deno.test("ai1.agent: memories outlast the session and are shared by all who talk with the agent", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead" });
  assertEquals((await (await agent.start(7)).ask("remember:blue")).text, 'lead #1 it is {"id":1}');
  const bob = await agent.start(8);
  assertEquals((await bob.ask("hi")).text, "lead\n\n## Your memories\n[1] blue #1 hi"); // in the context
  await bob.ask("replace:1:red");
  assertStringIncludes((await (await agent.start(8)).ask("hi")).text, "[1] red #"); // from the next session on
  await bob.ask("forget:1");
  assertEquals([await app.db.one`SELECT COUNT(*) FROM ai1_agent_memory`, await app.db.one`SELECT COUNT(*) FROM score`], [0, 0]); // its strength goes too
  assertStringIncludes((await bob.ask("forget:1")).text, '"error":"No such memory"'); // told to the model
}));

Deno.test("ai1.agent: memories renewed come first, the rest fades", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead" }), session = await agent.start(7);
  for (const fact of ["apple", "zebra"]) await session.ask(`remember:${fact}`);
  for (let i = 0; i < 3; i++) await session.ask("replace:2:zebra");
  assertStringIncludes((await (await agent.start(7)).ask("hi")).text, "[2] zebra\n[1] apple");
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

Deno.test("ai1.agent: what the user says strengthens the memories close to it, in the background", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead" });
  for (const [content, strength] of [["the logo is blue", 1], ["apples are red", 1.5]] as const) {
    const id = Number(await app.db.table("ai1_agent_memory").insert({ agent_id: agent.id, content }));
    await hit(app.db, "ai1_agent_memory", id, strength);
    await keep(app, "ai1_agent_memory", { agent_id: agent.id, memory_id: id }, content);
  }
  assertEquals(await index(app, agent.id), `## Your memories\n${HINT}\n[2] apples are red\n[1] the logo is blue`); // the stronger first
  assertEquals((await (await agent.start(7)).ask("how round is the logo?")).text, "lead\n\n## Your memories\n[2] apples are red\n[1] the logo is blue #1 how round is the logo?"); // no waiting
  for (let i = 0; i < 100 && (await index(app, agent.id)).endsWith("logo is blue"); i++) await new Promise((r) => setTimeout(r, 10));
  assertEquals(await index(app, agent.id), `## Your memories\n${HINT}\n[1] the logo is blue\n[2] apples are red`);
}));

Deno.test("ai1.agent: the api, for anyone signed in; a session only for its user", () => withApp(async (app) => {
  const agents = () => app.api["ai1.agent"].agents, agent = () => app.api["ai1.agent"].agent;
  const { id } = await runAs(app, 7, "test", () => agents().post({ system: "lead" })) as { id: number };
  await runAs(app, 8, "test", () => agent()(id).patch({ tools: ["toolset_clock_get"] })); // anyone may change it; one tool by its name
  assertEquals(await runAs(app, 7, "test", () => agent()(id).get()), { id, system: "lead", tools: ["toolset_clock_get"], prefer: {} });
  for (const tools of [["toolset"], ["toolset_clock"], ["toolset*"], ["get_toolset_clock"]]) { // what names no tool is refused
    await assertRejects(() => runAs(app, 8, "test", () => agent()(id).patch({ tools })), Error, "No such tools");
    await assertRejects(() => Agent.create(app, { tools }), Error, "No such tools");
  }
  const session = (await runAs(app, 7, "test", () => agent()(id).sessions.post()) as { id: number }).id;
  const answer = await runAs(app, 7, "test", () => app.api["ai1.agent"].sessions(session).ask.post({ content: "time?", wait: true })) as { text: string };
  assertEquals(answer.text, "lead #1 it is noon"); // the tools of its api paths
  assertEquals(await runAs(app, 7, "test", () => app.api["ai1.agent"].sessions(session).note.post({ content: "noted" })), { ok: true });
  const { messages } = await runAs(app, 7, "test", () => app.api["ai1.agent"].sessions(session).get()) as { messages: { role: string }[] };
  assertEquals(messages.map((m) => m.role), ["system", "user", "assistant", "tool", "assistant", "system"]);
  const bobs = [() => app.api["ai1.agent"].sessions(session).get(), () => app.api["ai1.agent"].sessions(session).ask.post({ content: "hi" }), () => app.api["ai1.agent"].sessions(session).note.post({ content: "hi" })];
  for (const call of bobs) {
    await assertRejects(() => runAs(app, 8, "test", call), Error, "No such session"); // not bob's: neither to read nor to talk in
  }
  const { id: memory } = await runAs(app, 8, "test", () => agent()(id).memories.post({ content: "blue" })) as { id: number };
  assertEquals(await runAs(app, 7, "test", () => agent()(id).memories.get()), [{ id: memory, content: "blue" }]);
  await runAs(app, 7, "test", () => agent()(id).memories(memory).delete());
  await assertRejects(() => runAs(app, 7, "test", () => agent()(99).get()), Error, "No such agent");
}));

Deno.test("ai1.agent: the model is chosen by the session's prefer, else the agent's, else the default", () => withApp(async (app) => {
  const n = await app.db.table("ai1_model").insert({ name: "n" }); // clever and dear, beside m: plain and cheap
  await app.db.table("ai1_model_provider").insert({ model_id: n, provider_id: 1, cost_input: 10, cost_output: 10 });
  await app.db.exec`UPDATE ai1_model_provider SET cost_input = 1, cost_output = 1 WHERE model_id = 1`;
  for (const capability of ["text", "tools"]) await app.db.table("ai1_model_capability").insert({ model_id: n, capability });
  for (const [model, value] of [[1, 10], [n, 50]]) await app.db.table("ai1_model_score").insert({ model_id: model, metric: "intelligence", value });
  const cheap = await Agent.create(app, { system: "lead", prefer: { cost: 1 } });
  assertEquals((await (await cheap.start(7)).ask("hi")).model, "m");
  assertEquals((await (await cheap.start(7, { prefer: { quality: 1 } })).ask("hi")).model, "n"); // the session's replaces it
  assertEquals((await (await (await Agent.create(app, { system: "lead", prefer: {} })).start(7, { prefer: {} })).ask("hi")).model, "n"); // none: the default, quality first
}));

Deno.test("ai1.agent: what the model is given is kept as the session starts: role with memories, tools, prefer", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead", tools: ["toolset_*"], prefer: { cost: 1 } });
  const session = await agent.start(7);
  const from = sent.length;
  for (const content of ["hi", "remember:blue", "time?"]) await session.ask(content);
  await session.note("the logo is round"); // at its place from the next turn on
  await session.ask("hi");
  assertEquals(sent.at(-1)!.slice(-2), [{ role: "system", content: "the logo is round" }, { role: "user", content: "hi" }]);
  await app.db.table("ai1_agent").update(agent.id, { system: "boss", tools: "[]" }); // changed meanwhile
  assertStringIncludes((await session.ask("time?")).text, "lead #5 it is {\"error\":\"No longer available: toolset_clock_get\""); // as given; runs only while still the agent's
  const calls = sent.slice(from).map((messages) => JSON.stringify(messages));
  for (const [i, call] of calls.entries()) if (i) assertEquals(call.slice(0, calls[i - 1].length - 1), calls[i - 1].slice(0, -1)); // only added to
  const given = (await app.db.col`SELECT message FROM ai1_session_message WHERE session_id = ${session.id} ORDER BY id`)
    .map((json) => JSON.parse(String(json))).filter((m) => m.role === "system");
  assertEquals(given.map((m) => m.content), [`${situation(agent.id, session.id, await app.url())}\n\n## Your role\nlead\n\n## Your memories\n${HINT}`, "the logo is round"]); // given once, and the note
  assertEquals(given[0].tools.map((t: { name: string }) => t.name), ["memories_post", "memories_delete", "search_post", "toolset_clock_get"]);
  assertEquals(given[0].prefer, { cost: 1 });
  assertEquals((await (await agent.start(7)).ask("hi")).text, "boss\n\n## Your memories\n[1] blue #1 hi"); // the next session
}));

Deno.test("ai1.agent: a failure is kept, but not sent again", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  await assertRejects(() => session.ask("fail"), Error, "down");
  assertEquals((await session.ask("hi")).text, "lead #2 hi");
  assertEquals((await kept(app, session.id)).map(([role]) => role), ["system", "user", "error", "user", "assistant"]);
}));

Deno.test("ai1.agent: one turn after the other in a session", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  const [first, second] = await Promise.all([session.ask("slow"), new Session(app, session.id).ask("then")]); // another handle, the same session
  assertEquals([first.text, second.text], ["lead #1 slow", "lead #2 then"]); // the second saw the first
}));

Deno.test("ai1.agent: with more than 20 tools, it is given those closest to its role and finds and calls the others", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "logo designer", tools: ["many_*", "toolset_*"] });
  const session = await agent.start(7);
  await session.ask("hi");
  const [given] = (await app.db.col`SELECT message FROM ai1_session_message WHERE session_id = ${session.id} ORDER BY id`)
    .map((json) => JSON.parse(String(json)));
  const names = given.tools.map((t: { name: string }) => t.name);
  assertEquals(names.length, 3 + 15 + 2); // its own, the 15 closest, find_tools and core's tool-calls
  assertEquals([names.includes("many_logo_get"), names.slice(-2)], [true, ["find_tools", "core_toolCalls_post"]]);
  assertStringIncludes((await session.ask("find:draw a logo")).text, '"name":"many_logo_get"');
  const missing = Array.from({ length: 24 }, (_, i) => `many_tool${i}_get`).find((name) => !names.includes(name))!;
  assertStringIncludes((await session.ask(`call:${missing}`)).text, `it is {"results":[`);
  assertStringIncludes((await session.ask("call:core_t_post")).text, '"error":"Not one of your tools: core_t_post"');
}));

Deno.test("ai1.agent: its tools by nearness to its role, and which a session starts with", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "logo designer", tools: ["many_*", "toolset_*"] });
  const tools = await agent.tools(), paths = tools.filter((t) => !t.always);
  assertEquals(paths[0].tool.name, "many_logo_get"); // the nearest to its role first
  assert(paths[0].score! > paths.at(-1)!.score!);
  assertEquals(paths.filter((t) => t.given).length, 15); // with many, the 15 closest
  assertEquals(tools.filter((t) => t.always).map((t) => t.tool.name).slice(-2), ["find_tools", "core_toolCalls_post"]); // its own, and to find the others
  const few = await (await Agent.create(app, { system: "lead", tools: ["toolset_*"] })).tools();
  assert(few.length > 3 && few.every((t) => t.given)); // with few, all
}));

Deno.test("ai1.agent: agents are found by their role, embedded once", () => withApp(async (app) => {
  const agents = () => (app.api as any)["ai1.agent"].agents, agent = () => (app.api as any)["ai1.agent"].agent;
  const designer = await Agent.create(app, { system: "logo designer\nmakes logos" });
  await Agent.create(app, { system: "lead" });
  await new Promise((r) => setTimeout(r, 20)); // roles are embedded in the background
  const found = await runAs(app, 7, "test", () => agents().get(undefined, { search: "a logo" })) as { id: number; role: string; score: number }[];
  assertEquals([found[0].id, found[0].role], [designer.id, "logo designer"]); // the nearest first, its role's first line
  assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM embedding_ai1_agent`), 2);
  await runAs(app, 7, "test", () => agent()(designer.id).patch({ system: "lead too" })); // changed: embedded again
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(await app.db.col`SELECT content FROM embedding_ai1_agent WHERE agent_id = ${designer.id}`, ["lead too"]);
}));

Deno.test("ai1.agent: cancel stops the answer on its way, even one that never comes, and the session goes on", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead" }), session = await agent.start(7);
  const hung = session.ask("hang");
  await new Promise((r) => setTimeout(r, 20));
  const next = session.ask("hello"); // waits for its turn
  assert(session.running);
  assert(session.cancel());
  await assertRejects(() => hung, Error, "Cancelled");
  assertStringIncludes((await next).text, "hello");
  assertEquals(session.cancel(), false); // nothing on its way
  assertEquals(session.running, false);
}));

Deno.test("ai1.agent: what a step said before it broke off stays, marked", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead" }), session = await agent.start(7);
  await assertRejects(() => session.ask("break"), Error, "broken");
  assertEquals((await kept(app, session.id)).slice(-3), [["user", "break", ""], ["assistant", "so far\n\n(interrupted)", ""], ["error", "broken", ""]]);
}));

Deno.test("ai1.agent: asked over the api, the agent answers in the background; the answer is kept", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "lead" }), session = await agent.start(7);
  const api = app.api["ai1.agent"].sessions(session.id);
  assertEquals(await runAs(app, 7, "test", () => api.ask.post({ content: "slow" })), { running: true });
  assert(session.running);
  while (session.running) await new Promise((r) => setTimeout(r, 10));
  assertEquals((await kept(app, session.id)).at(-1), ["assistant", "lead #1 slow", "m"]);
}));
