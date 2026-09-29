import { App, runAs, unixTime } from "@qino/qino";
import { assert, assertStringIncludes } from "@qino/qino/tests";
import { hit } from "@qino/qino/score";
import { Agent } from "@qino/qino/ai1.agent";

import { agents, recent } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.agents: every agent with its memories and sessions, and what is going on", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "ai1.tools", "cron", "score", "ai1.embed", "ai1.agent"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const agent = await Agent.create(app, { system: "<b>lead</b>", tools: ["cms"] });
    const session = await agent.start(7);
    const memory = Number(await app.db.table("ai1_agent_memory").insert({ agent_id: agent.id, content: "the <i>logo</i> is blue" }));
    await hit(app.db, "ai1_agent_memory", memory, 3);
    for (const message of [{ role: "user", content: "hi" }, { role: "assistant", content: "", toolCalls: [{ id: "1", name: "post_search", args: { query: "logo" } }] }]) {
      await app.db.table("ai1_session_message").insert({ session_id: session.id, time: unixTime(), message: JSON.stringify(message) });
    }
    const node = { app } as unknown as Node;
    const feed = String(await runAs(app, 7, "test", () => recent(node)));
    for (const part of ["ann@example.test", "hi", '→ post_search({"query":"logo"})'.replaceAll('"', "&quot;")]) assertStringIncludes(feed, part);
    const all = String(await runAs(app, 7, "test", () => agents(node)));
    for (const part of ["&lt;b&gt;lead&lt;/b&gt;", "the &lt;i&gt;logo&lt;/i&gt; is blue", "<td>3.00", "tools: cms", "2 messages", "active"]) assertStringIncludes(all, part);
    assert(!all.includes("<b>lead"));
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
