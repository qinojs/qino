import { App, runAs } from "@qino/qino";
import { assertEquals, assertRejects, assertStringIncludes } from "@qino/qino/tests";
import { Agent } from "@qino/qino/ai.agent";

import type { Adapter, Message } from "@qino/qino/ai";

// Asked "report", it reports once with the tool it was given; else it answers "ok".
const sent: Message[][] = [];
const fake: Adapter = {
  text: (_call, { messages }) => {
    sent.push(messages);
    const last = messages.at(-1);
    if (last.role === "user" && last.content === "report") {
      return Promise.resolve({ text: "", toolCalls: [{ id: "1", name: "feedback_post", args: { kind: "description", about: "iot_provider_action_post", content: "unclear" } }], truncated: false });
    }
    return Promise.resolve({ text: "ok", toolCalls: [], truncated: false });
  },
};

Deno.test("ai.agent.feedback: an agent reports to the developers, with its session; anyone signed in through the api", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai", "ai.tools", "cron", "score", "ai.embed", "ai.discover", "ai.agent", "ai.agent.feedback"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  app.modules.get("ai")!.plugin.aiAdapters.fake = fake;
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai_model").insert({ name: "m" });
    await app.db.table("ai_model_provider").insert({ model_id: 1, provider_id: 1 });
    for (const capability of ["text", "tools"]) await app.db.table("ai_model_capability").insert({ model_id: 1, capability });
    const agent = await Agent.create(app, { system: "lead" }), session = await agent.start(7);
    await session.ask("report");
    await session.ask("report"); // the same again: kept once
    const given = sent[0][0].content as string;
    assertStringIncludes(given, "## Feedback\nWhen something was not set up");
    const tool = (await app.db.col`SELECT message FROM ai_session_message WHERE session_id = ${session.id}`)
      .map((json) => JSON.parse(String(json))).find((m) => m.tools)!.tools.find((t: { name: string }) => t.name === "feedback_post");
    assertEquals(Object.keys(tool.parameters.properties), ["kind", "about", "content"]); // its model it need not tell
    assertEquals(tool.parameters.properties.kind.enum, ["config", "description", "bug", "idea"]);
    assertEquals(await app.db.query`SELECT usr_id, agent_id, session_id, model, kind, about, content, done FROM ai_agent_feedback`.then((rows) => rows.map((r) => ({ ...r, done: !!r.done } as Record<string, unknown>))),
      [{ usr_id: 7, agent_id: agent.id, session_id: session.id, model: "m", kind: "description", about: "iot_provider_action_post", content: "unclear", done: false }]); // its model too
    // through the api, e.g. by an AI through MCP: no agent, no session
    await runAs(app, 7, "test", () => app.api["ai.agent.feedback"].post({ kind: "config", content: " no credit left ", model: "claude-opus-5-5" }));
    assertEquals(await app.db.row`SELECT usr_id, agent_id, session_id, model, kind, about, content FROM ai_agent_feedback ORDER BY id DESC`,
      { usr_id: 7, agent_id: null, session_id: null, model: "claude-opus-5-5", kind: "config", about: "", content: "no credit left" });
    await assertRejects(() => runAs(app, 7, "test", () => app.api["ai.agent.feedback"].post({ kind: "other", content: "x" })), Error, "Validation failed");
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    delete app.modules.get("ai")!.plugin.aiAdapters.fake;
    await app.db.close();
  }
});
