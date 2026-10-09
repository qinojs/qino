import { App, runAs, unixTime } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { hit } from "@qino/qino/score";
import { Agent } from "@qino/qino/ai.agent";

import { agent as about, agents, cms, conversation, memories, session as aboutSession, sessions, tools } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai.agents: agents, their sessions and memories, and a session's conversation", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai", "ai.tools", "cron", "score", "ai.embed", "ai.discover", "ai.agent"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const agent = await Agent.create(app, { system: "<b>lead</b>", tools: ["aiDiscover_*"] });
    const session = await agent.start(7);
    const memory = Number(await app.db.table("ai_agent_memory").insert({ agent_id: agent.id, content: "the <i>logo</i> is blue " + "x".repeat(90) }));
    await hit(app.db, "ai_agent_memory", memory, 3);
    // the model "m" at the provider "fake" answered the last message
    const provider = await app.db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    const model = await app.db.table("ai_model").insert({ name: "m" });
    const at = Number(await app.db.table("ai_model_provider").insert({ model_id: model, provider_id: provider }));
    const ids: number[] = [];
    for (const [message, by] of [
      [{ role: "system", content: "lead", tools: [{ name: "search_post", description: "Search", parameters: {} }], prefer: { cost: 1 } }, 0],
      [{ role: "user", content: "hi" }, 0],
      [{ role: "assistant", content: "", toolCalls: [{ id: "1", name: "search_post", args: { query: "logo" } }] }, 0],
      [{ role: "tool", id: "1", content: '[{"text":"round"}]' }, 0],
      [{ role: "error", content: "down" }, 0],
      [{ role: "assistant", content: "it is round" }, at],
    ] as const) {
      ids.push(Number(await app.db.table("ai_session_message").insert({
        session_id: session.id, time: unixTime(), message: JSON.stringify(message), ...by && { model_provider_id: by },
      })));
    }
    const node = { app, page: () => ({ url: () => Promise.resolve("/agents") }) } as unknown as Node;
    const as = <T>(fn: () => Promise<T>) => runAs(app, 7, "test", fn).then(String);

    const home = await as(() => cms.node.render(node));
    for (const part of ["New agent", "data-agent=", "name=system", "name=tools", "<fieldset><legend>Tools", "<fieldset><legend>Model choice", "<div class=u2-table>", "data-prefer"]) {
      assertStringIncludes(home, part);
    }
    // the tools as a tree of their names: a branch for all below it, a leaf for one tool
    for (const part of ['value="aiDiscover_*"', 'value="aiDiscover_tools_*"', 'value="aiDiscover_tools_get"']) assertStringIncludes(home, part);

    await app.db.table("ai_agent").update(agent.id, { name: "some.module/lead" }); // declared by a module
    const list = await as(() => agents(node));
    assertStringIncludes(list, "<td>some.module/lead");
    for (const part of [`href="/agents?agent=${agent.id}"`, "&lt;b&gt;lead&lt;/b&gt;", "max-width:15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", 'title="[&quot;aiDiscover_*&quot;]"', "[&quot;aiDiscover_*&quot;]</small>", "it is round"]) {
      assertStringIncludes(list, part);
    }
    assertStringIncludes(list, "<th>#");
    assertEquals(list.match(/writing-mode:sideways-lr/g)?.length, 5);
    assert(!list.includes("<b>lead"));

    const its = await as(() => sessions(node, { vars: { agent: agent.id } }));
    for (const part of [`href="/agents?session=${session.id}"`, "ann@example.test", "color:var(--red)\">1</span>", ">m</span>", ">fake</span>", "active"]) {
      assertStringIncludes(its, part);
    }
    // its page: everything about it
    const page = await as(() => about(node, { vars: { agent: agent.id } }));
    for (const part of [">m</span>", ">fake</span>", "ann@example.test", " questions", " errors"]) {
      assertStringIncludes(page, part);
    }
    assert(!page.includes("&lt;b&gt;lead&lt;/b&gt;"));
    assert(!page.includes("Model choice"));
    assert(!page.includes("Findable"));
    assert(!page.includes("active now"));
    assert(!page.includes("[object Promise]"));
    assertStringIncludes(await as(() => about(node, { vars: { agent: 999 } })), "No such agent");

    // a session's page: everything about it
    const its2 = await as(() => aboutSession(node, { vars: { session: session.id } }));
    for (const part of [`href="/agents?agent=${agent.id}"`, "ann@example.test", ">m</span>", ">search_post</span>", "1: search_post"]) {
      assertStringIncludes(its2, part);
    }
    assert(!its2.includes("[object Promise]"));
    assertStringIncludes(await as(() => aboutSession(node, { vars: { session: 999 } })), "No such session");

    // its tools, by nearness to its role
    const available = await as(() => tools(node, { vars: { agent: agent.id } }));
    for (const part of ["Tool", "In context", "icon=push_pin"]) assertStringIncludes(available, part);
    assert(!available.includes("[object Promise]"));

    const kept = await as(() => memories(node, { vars: { agent: agent.id } }));
    for (const part of ["the &lt;i&gt;logo&lt;/i&gt; is blue", `data-memory=${memory}`, "x".repeat(90), " …</button>", "<td>3.00", "icon=push_pin", "<td>–"]) {
      assertStringIncludes(kept, part);
    }
    assert(!kept.includes(">Score"));
    assert(!kept.includes("[object Promise]"));

    const talk = await as(() => conversation(node, { vars: { session: session.id } }));
    for (const part of ["align-self:flex-end", "color:white\">search_post</small>", "<button type=button class=u2-unstyle data-call=", "<details>", "color:var(--red)", "1 tools: search_post", "prefer {&quot;cost&quot;:1}", "@ <span"]) {
      assertStringIncludes(talk, part);
    }
    // the dialog of the calls: each with its result
    const { calls } = await cms.node.api(node, { calls: session.id, call: "1" }) as { calls: any[] };
    assertEquals(calls.map((c) => c.name), ["search_post"]);
    assertEquals(calls[0].result, [{ text: "round" }]);
    // following along: only what came after the last message shown
    const since = await as(() => conversation(node, { vars: { session: session.id, after: ids.at(-2) } }));
    assertEquals([...since.matchAll(/data-message=(\d+)/g)].map((m) => Number(m[1])), [ids.at(-1)]);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
