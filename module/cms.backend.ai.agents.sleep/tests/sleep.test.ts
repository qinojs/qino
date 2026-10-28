import { App, runAs } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { Agent } from "@qino/qino/ai.agent";

import { agents, cms, night, nights } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai.agents.sleep: the agents, their nights, and a night's plan and thoughts in words", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai", "ai.tools", "cron", "score", "ai.embed", "ai.discover", "ai.agent", "ai.agent.sleep"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const agent = await Agent.create(app, { system: "brand <b>designer</b>" });
    const memory = Number(await app.db.table("ai_agent_memory").insert({ agent_id: agent.id, content: "the logo is blue" }));
    const node = { app, page: () => ({ url: () => "/sleep" }) } as unknown as Node;
    const as = (fn: () => Promise<unknown>) => runAs(app, 7, "test", fn).then(String);

    const list = await as(() => agents(node));
    for (const part of ["brand &lt;b&gt;designer&lt;/b&gt;", `data-sleep=${agent.id} disabled`]) assertStringIncludes(list, part); // nothing new: no sleep
    assertStringIncludes(await as(() => nights(node)), "Not slept yet");
    assertEquals(await cms.node.api(node, { sleep: agent.id }), { ok: true, asleep: 0 });

    const plan = { add: [{ content: "answer in German", session: 4 }], merge: [], strengthen: [memory], weaken: [], forget: [] };
    const id = await app.db.table("ai_agent_sleep").insert({ agent_id: agent.id, time: 1, until: 9, stage: "planned", expected: 1, plan: JSON.stringify(plan) });
    await app.db.table("ai_agent_sleep_thought").insert({ sleep_id: id, item: `think:${id}:4:0`,
      output: JSON.stringify({ missed: [{ content: "answer in German", evidence: [12] }], confirmed: [{ id: memory, evidence: [13] }], outdated: [] }) });
    for (const part of ['href="/sleep?night=1"', "plan ready", "add 1 · merge 0 · strengthen 1"]) assertStringIncludes(await as(() => nights(node)), part);

    const shown = await as(() => night(node, { vars: { night: id } }));
    for (const part of ["answer in German <small>session 4", "<code>1</code> the logo is blue", "#12", "#13", `data-apply=${id}`]) assertStringIncludes(shown, part);
    assertEquals(await cms.node.api(node, { apply: id }), { ok: true });
    assertEquals(await app.db.one`SELECT stage FROM ai_agent_sleep WHERE id = ${id}`, "applied");
  } finally {
    await new Promise((r) => setTimeout(r, 60));
    await app.db.close();
  }
});
