// deno-lint-ignore-file no-explicit-any
import { App } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { collections, drop } from "@qino/qino/ai1.embed";
import { Agent } from "@qino/qino/ai1.agent";

import type { Adapter } from "@qino/qino/ai1";

// Answers with its context and the question; "remember:fact" and "forget:id" (of the user's) call
// those tools. It takes what says "always" for personal.
const fake: Adapter = {
  text: (_call, { messages }) => {
    const last = messages.at(-1), [verb, a] = String(last.content).split(":");
    if (last.role === "user" && verb === "remember") return Promise.resolve({ text: "", toolCalls: [{ id: "1", name: "post_memories", args: { content: a } }], truncated: false });
    if (last.role === "user" && verb === "forget") return Promise.resolve({ text: "", toolCalls: [{ id: "1", name: "delete_user_memories", args: { memory: Number(a) } }], truncated: false });
    return Promise.resolve({ text: `${messages[0].content} | ${last.content}`, toolCalls: [], truncated: false });
  },
  decide: (_call, { content }) => Promise.resolve({ choice: String(content).includes("always") ? "personal" : "shared" }),
};

Deno.test("ai1.user_memory: what is about the user is theirs, with every agent, in their sessions only", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "ai1.tools", "cron", "score", "ai1.embed", "ai1.agent", "ai1.user_memory"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  app.modules.get("ai1")!.plugin.ai1Adapters.fake = fake;
  try {
    for (const { id } of await collections(app)) await drop(app, id); // nothing to embed here
    await app.settings.core.url("https://example.test/");
    for (const [id, username] of [[7, "ann@example.test"], [8, "bob@example.test"]] as const) await app.db.table("usr").insert({ id, username, active: true });
    await app.db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai1_model").insert({ name: "m" });
    await app.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
    for (const capability of ["text", "tools", "decide"]) await app.db.table("ai1_model_capability").insert({ model_id: 1, capability });

    const lead = await Agent.create(app, { system: "lead" }), designer = await Agent.create(app, { system: "designer" });
    const ann = await lead.start(7);
    assertStringIncludes((await ann.ask("remember:always German")).text, '{"id":"u1"}'); // the user's
    assertStringIncludes((await ann.ask("remember:the logo is blue")).text, '{"id":1}'); // the agent's
    assertEquals(await app.db.col`SELECT content FROM ai1_user_memory WHERE usr_id = 7`, ["always German"]);

    const withDesigner = (await (await designer.start(7)).ask("hi")).text; // another agent knows it too
    assertStringIncludes(withDesigner, "About the user you talk with:\n[u1] always German");
    assert(!withDesigner.includes("logo")); // the lead's memory stays the lead's
    const bob = (await (await lead.start(8)).ask("hi")).text; // another user does not see it
    assertStringIncludes(bob, "[1] the logo is blue");
    assert(!bob.includes("German"));

    await ann.ask("forget:1");
    assertEquals(await app.db.col`SELECT content FROM ai1_user_memory`, []);
  } finally {
    delete app.modules.get("ai1")!.plugin.ai1Adapters.fake;
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
