import { App, runAs } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";
import { collections, create, drop } from "@qino/qino/ai.embed";
import { Agent } from "@qino/qino/ai.agent";

import type { Adapter } from "@qino/qino/ai";

// Three meanings: what says "logo", what says "tool", all else; the model answers "ok".
const fake: Adapter = {
  embed: (_call, { texts }) => Promise.resolve(texts.map((t: string) => /logo/i.test(t) ? [1, 0, 0] : /tool/i.test(t) ? [0, 1, 0] : [0, 0, 1])),
  text: () => Promise.resolve({ text: "ok", toolCalls: [], truncated: false }),
};

async function withApp(fn: (app: App) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai", "ai.tools", "cron", "score", "ai.embed", "ai.discover", "ai.agent", "ai.agent.recall"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  app.modules.add(new URL("../../ai.agent/tests/many/plugin.ts", import.meta.url));
  await app.init();
  app.modules.get("ai")!.plugin.aiAdapters.fake = fake;
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai_model").insert({ name: "m" });
    await app.db.table("ai_model_provider").insert({ model_id: 1, provider_id: 1 });
    for (const capability of ["text", "tools", "embed"]) await app.db.table("ai_model_capability").insert({ model_id: 1, capability });
    for (const { id } of await collections(app)) await drop(app, id);
    await create(app, "m", 3);
    await fn(app);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // embeddings run in the background
    delete app.modules.get("ai")!.plugin.aiAdapters.fake;
    await app.db.close();
  }
}

/** The notes kept in `session`, after the background is done. */
async function notes(app: App, session: number) {
  for (let i = 0, n = -1; i < 50; i++) { // until no more come
    await new Promise((r) => setTimeout(r, 20));
    const now = Number(await app.db.one`SELECT COUNT(*) FROM ai_session_message WHERE session_id = ${session}`);
    if (now === n) break;
    n = now;
  }
  return (await app.db.col`SELECT message FROM ai_session_message WHERE session_id = ${session} ORDER BY id`)
    .map((json) => JSON.parse(String(json))).filter((m) => m.role === "system" && !m.content.startsWith("Now: "))
    .map((m) => m.content);
}

Deno.test("ai.agent.recall: what is close to what was said and not given yet comes to mind, once", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "tool lead", tools: ["many_*"] }); // 25 tools: the logo one, far from its role, not given
  const session = await agent.start(7);
  await session.ask("hi");
  assertEquals(await notes(app, session.id), []); // nothing close
  await runAs(app, 7, "test", () => app.api["ai.agent"].agent(agent.id).memories.post({ content: "the logo is blue" })); // not given: kept later
  await session.ask("draw the logo");
  assertEquals(await notes(app, session.id), [
    "## Possibly relevant memories\n[1] the logo is blue\n\n## Possibly relevant tools\nNot in your tool list; call them with call_tool.\n- many_logo_get: Draws a logo",
  ]);
  assertEquals([...await session.known()].filter((key) => key === "1" || key === "many_logo_get"), ["1", "many_logo_get"]); // known now
  await session.ask("the logo again");
  assertEquals((await notes(app, session.id)).length, 1); // given already
}));

Deno.test("ai.agent.recall: a text said before comes to mind too, with its stored vector", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "tool lead", tools: ["many_*"] });
  const tools = "## Possibly relevant tools\nNot in your tool list; call them with call_tool.\n- many_logo_get: Draws a logo";
  for (const _ of [1, 2]) { // the second session's message is embedded already
    const session = await agent.start(7);
    await session.ask("draw the logo");
    assertEquals(await notes(app, session.id), [tools]);
  }
}));

Deno.test("ai.agent.recall: what was said earlier and is no longer sent comes to mind", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  const said = "the logo must stay round in every version we make";
  await session.ask(said);
  assertEquals((await notes(app, session.id)).filter((note) => note.includes("Said earlier")), []); // still sent
  // as a compaction would: what was said is no longer sent
  app.on("ai.agent:history", (turn) => { turn.history = turn.history.filter((row: { message: { content: unknown } }) => row.message.content !== said); });
  await session.ask("draw the logo");
  const id = Number(await app.db.one`SELECT id FROM ai_session_message WHERE message LIKE ${`%${said}%`}`);
  assertEquals((await notes(app, session.id)).filter((note) => note.includes("Said earlier")), [`## Said earlier in this session\n[#${id}] ${said}`]);
}));
