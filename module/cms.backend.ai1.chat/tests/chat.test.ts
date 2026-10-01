import { App, runAs } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { Agent } from "@qino/qino/ai1.agent";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.chat: every agent to open, and who would answer by the weights", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "ai1.tools", "cron", "score", "ai1.embed", "ai1.discover", "ai1.agent"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("ai1_provider").insert({ name: "p", type: "openai", endpoint: "" });
    for (const [name, capabilities] of [["plain", ["text"]], ["handy", ["text", "tools"]]] as const) {
      const id = await app.db.table("ai1_model").insert({ name });
      await app.db.table("ai1_model_provider").insert({ model_id: id, provider_id: 1 });
      for (const capability of capabilities) await app.db.table("ai1_model_capability").insert({ model_id: id, capability });
    }
    await Agent.create(app, { system: "<b>lead</b>\nmore", tools: ["ai1.agent"], prefer: { cost: 3 } });
    const node = { app } as unknown as Node;
    const page = String(await runAs(app, 7, "test", () => cms.node.render(node)));
    for (const part of ["#1</span> &lt;b&gt;lead&lt;/b&gt;</summary>", 'value="ai1.agent" checked', 'data-key="cost"> <output>3</output>']) assertStringIncludes(page, part);
    // the tools as a tree: each module a tristate tree, what is below a chosen path checked with it
    assertStringIncludes(page, '<u2-tree tristate><input type=checkbox slot=icon name=tools value="ai1.agent" checked> ai1.agent');
    assertStringIncludes(page, '<u2-tree><input type=checkbox slot=icon name=tools value="ai1.agent/agents" checked> agents');
    assertEquals(await cms.node.api(node, { preview: { cost: 1 } }), { ok: true, list: [{ model: "handy", provider: "p", rank: 0 }] }); // only who has tools (no price known: no points for cost)
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
