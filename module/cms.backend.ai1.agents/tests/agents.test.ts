import { App, runAs, unixTime } from "@qino/qino";
import { assert, assertStringIncludes } from "@qino/qino/tests";
import { hit } from "@qino/qino/score";
import { Agent } from "@qino/qino/ai1.agent";

import { agents, conversation, memories, sessions } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.agents: agents, their sessions and memories, and a session's conversation", async () => {
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
    for (const [message, model] of [
      [{ role: "system", content: "lead", tools: [{ name: "post_search", description: "Search", parameters: {} }], prefer: { cost: 1 } }, ""],
      [{ role: "user", content: "hi" }, ""],
      [{ role: "assistant", content: "", toolCalls: [{ id: "1", name: "post_search", args: { query: "logo" } }] }, ""],
      [{ role: "tool", id: "1", content: '[{"text":"round"}]' }, ""],
      [{ role: "error", content: "down" }, ""],
      [{ role: "assistant", content: "it is round" }, "m"],
    ] as const) {
      await app.db.table("ai1_session_message").insert({ session_id: session.id, time: unixTime(), message: JSON.stringify(message), model });
    }
    const node = { app } as unknown as Node;
    const as = <T>(fn: () => Promise<T>) => runAs(app, 7, "test", fn).then(String);

    const list = await as(() => agents(node));
    for (const part of [`data-agent="${agent.id}"`, "&lt;b&gt;lead&lt;/b&gt;", "<small>cms</small>", "it is round"]) assertStringIncludes(list, part);
    assert(!list.includes("<b>lead"));

    const its = await as(() => sessions(node, { vars: { agent: agent.id } }));
    for (const part of [`data-session="${session.id}"`, "ann@example.test", "color:var(--red)\">1</span>", ">m</span>", "active"]) assertStringIncludes(its, part);
    const kept = await as(() => memories(node, { vars: { agent: agent.id } }));
    for (const part of ["the &lt;i&gt;logo&lt;/i&gt; is blue", "<td>3.00"]) assertStringIncludes(kept, part);

    const talk = await as(() => conversation(node, { vars: { session: session.id } }));
    for (const part of ["align-self:flex-end", "→ post_search", "← [{&quot;text&quot;:&quot;round&quot;}]", "<details>", "color:var(--red)", "1 tools: post_search", "prefer {&quot;cost&quot;:1}"]) assertStringIncludes(talk, part);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
