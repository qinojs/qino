import { App, runAs } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { Agent } from "@qino/qino/ai.agent";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai.chat: choose an agent, resume own sessions, and preview session weights", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai", "ai.tools", "cron", "score", "ai.embed", "ai.discover", "ai.agent"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("ai_provider").insert({ name: "p", type: "openai", endpoint: "" });
    for (const [name, capabilities] of [["plain", ["text"]], ["handy", ["text", "tools"]]] as const) {
      const id = await app.db.table("ai_model").insert({ name });
      await app.db.table("ai_model_provider").insert({ model_id: id, provider_id: 1 });
      for (const capability of capabilities) await app.db.table("ai_model_capability").insert({ model_id: id, capability });
    }
    const agent = await Agent.create(app, { system: "<b>lead</b>\nmore", tools: ["aiAgent_*"], prefer: { cost: 3 } });
    const own = await agent.start(7), other = await agent.start(8);
    await app.db.table("ai_session_message").insert({ session_id: own.id, message: JSON.stringify({ role: "user", content: "My first question about the <blue> logo " + "x".repeat(90) }) });
    const node = { app, page: async () => ({ url: async () => "/chat" }) } as unknown as Node;
    const page = String(await runAs(app, 7, "test", () => cms.node.render(node)));
    for (const part of ['<option value="1" data-prefer="{&quot;cost&quot;:3}">#1 &lt;b&gt;lead&lt;/b&gt;</option>', `<tr u2-href>`, `href="/chat?session=${own.id}" data-session="${own.id}"`, "Model choice for this session", "Start session", "<table class=u2-table>", "My first question about the &lt;blue&gt; logo", " …"]) assertStringIncludes(page, part);
    assertStringIncludes(page, 'style="overflow:auto; max-height:30rem; padding:0"');
    assert(!page.includes("<blue>"));
    assert(!page.includes(`data-session="${other.id}"`));
    assert(!page.includes("data-agent="));
    assertEquals(await cms.node.api(node, { preview: { cost: 1 } }), { ok: true, list: [{ model: "handy", provider: "p", rank: 0 }] }); // only who has tools (no price known: no points for cost)
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
