import { App, runAs, unixTime } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { Agent } from "@qino/qino/ai.agent";

import { cms, failed, reports, topics } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai.feedback: reports by what they are about, to deal with; the tool calls that failed", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai", "ai.tools", "cron", "score", "ai.embed", "ai.discover", "ai.agent", "ai.agent.feedback"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const session = await (await Agent.create(app, { system: "lead" })).start(7);
    const table = app.db.table("ai_agent_feedback");
    const unclear = Number(await table.insert({ time: unixTime(), usr_id: 7, session_id: session.id, model: "m", kind: "description", about: "iot_get", content: "what is <b>an</b> entity?" }));
    await table.insert({ time: unixTime(), usr_id: 7, model: "n", kind: "description", about: "iot_get", content: "which provider?" });
    await table.insert({ time: unixTime(), usr_id: 7, kind: "config", about: "", content: "no credit left" });
    for (const [message, at] of [
      [{ role: "assistant", content: "", toolCalls: [{ id: "1", name: "iot_get", args: {} }, { id: "2", name: "cms_get", args: {} }] }, 1],
      [{ role: "tool", id: "1", content: '{"error":"No such provider"}' }, 2],
      [{ role: "tool", id: "2", content: "[]" }, 3],
    ] as const) await app.db.table("ai_session_message").insert({ session_id: session.id, time: at, message: JSON.stringify(message) });
    const node = { app, page: () => ({ url: () => "/feedback" }), cms: { nodeByModule: () => undefined } } as unknown as Node;
    const as = (fn: () => Promise<unknown>) => runAs(app, 7, "test", fn).then(String);

    const all = await as(() => topics(node)), operator = await as(() => topics(node, { vars: { kind: "config" } }));
    for (const part of ['href="/feedback?kind=description&amp;about=iot_get"', "<td>2\n      <td>2\n      <td>1\n      <td>2", 'href="/feedback?kind=config&amp;about=-"']) assertStringIncludes(all, part); // 2 open, 2 reports, 1 session, 2 models
    assertStringIncludes(operator, "<i>system</i>");
    assert(!operator.includes("iot_get")); // only of its kind
    const open = await as(() => reports(node));
    for (const part of ["what is &lt;b&gt;an&lt;/b&gt; entity?", "no credit left", `session ${session.id}`, "ann@example.test", `data-done="${unclear}"`, ">m</span>"]) assertStringIncludes(open, part);
    assert(!(await as(() => reports(node, { vars: { about: "-" } }))).includes("entity?")); // only those about the whole
    assert(!(await as(() => reports(node, { vars: { kind: "config" } }))).includes("entity?")); // only those of a kind
    const tools = await as(() => failed(node));
    for (const part of [">iot_get</span>", "<td>1\n      <td>1", "No such provider"]) assertStringIncludes(tools, part);
    assert(!tools.includes("cms_get")); // it did not fail

    assertEquals(await cms.node.api(node, { done: unclear }), { ok: true });
    assert(!(await as(() => reports(node))).includes("entity?")); // dealt with: only with done
    assertStringIncludes(await as(() => reports(node, { vars: { done: 1 } })), `data-open="${unclear}"`);
    assertEquals(await cms.node.api(node, { remove: unclear }), { ok: true });
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM ai_agent_feedback`), 2);
  } finally {
    await app.db.close();
  }
});
