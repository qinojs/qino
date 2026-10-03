// deno-lint-ignore-file no-explicit-any
import { App, runAs } from "@qino/qino";
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@qino/qino/tests";
import { Agent } from "@qino/qino/ai1.agent";

import type { Adapter } from "@qino/qino/ai1";

// Asked to compact, it first remembers a rule, then answers with a handoff; else it echoes what it
// was sent: the roles, and the first words of each message.
const sent: any[][] = [];
const fake: Adapter = {
  text: (_call, { messages }) => {
    sent.push(messages);
    const last = messages.at(-1);
    if (last.role === "tool") return Promise.resolve({ text: "HANDOFF", toolCalls: [], truncated: false });
    if (String(last.content).includes("about to be compacted")) {
      return Promise.resolve({ text: "", toolCalls: [{ id: "r", name: "memories_post", args: { content: "always German" } }], truncated: false });
    }
    return Promise.resolve({ text: "ok", toolCalls: [], truncated: false });
  },
};

async function withApp(fn: (app: App) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "ai1.tools", "cron", "score", "ai1.embed", "ai1.discover", "ai1.agent", "ai1.agent.sleep"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  app.modules.get("ai1")!.plugin.ai1Adapters.fake = fake;
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("usr").insert({ id: 8, username: "bob@example.test", active: true });
    await app.db.table("usr").insert({ id: 9, username: "root@example.test", active: true, superuser: true });
    await app.db.table("ai1_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai1_model").insert({ name: "m", context_length: 5000 });
    await app.db.table("ai1_model_provider").insert({ model_id: 1, provider_id: 1 });
    for (const capability of ["text", "tools"]) await app.db.table("ai1_model_capability").insert({ model_id: 1, capability });
    await fn(app);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    delete app.modules.get("ai1")!.plugin.ai1Adapters.fake;
    await app.db.close();
  }
}

const summaries = async (app: App) =>
  (await app.db.col`SELECT message FROM ai1_session_message`).map((json) => JSON.parse(String(json))).filter((m) => m.summary);

Deno.test("ai1.agent.sleep: a long session is compacted, the record stays", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  const long = (n: number) => `q${n} ` + "x".repeat(1500);
  let n = 0;
  while (!(await summaries(app)).length && n < 10) {
    await session.ask(long(++n));
    await new Promise((r) => setTimeout(r, 10)); // compacting runs in the background
  }
  const [summary] = await summaries(app);
  assert(summary, "compacted");
  assertEquals(summary.content, "Summary of this session before the last turns:\nHANDOFF");

  // the same messages as the last answer, then the instruction: the prompt cache holds
  const compacting = sent.findLast((m) => m.at(-1).role === "system" && String(m.at(-1).content).includes("compacted"))!;
  const answering = sent.findLast((m) => m.at(-1).role === "user")!;
  assertEquals(compacting.slice(0, answering.length), answering);
  assertEquals(await app.db.col`SELECT content FROM ai1_agent_memory`, ["always German"]); // what lasts, first

  await session.ask("next");
  const next = sent.at(-1)!, from = summary.summary.from;
  assertEquals(next[1], { role: "system", content: summary.content }); // after the given block
  const first = String(await app.db.one`SELECT message FROM ai1_session_message WHERE id = ${from}`);
  assertStringIncludes(String(next[2].content), JSON.parse(first).content.slice(0, 3)); // then word for word from `from` on
  assert(!next.some((m) => String(m.content).startsWith("q1 "))); // what came before is not sent
  assertEquals((await app.db.col`SELECT message FROM ai1_session_message`).filter((json) => String(json).includes('"q1 ')).length, 1); // but kept
}));

Deno.test("ai1.agent.sleep: a short session is sent as it is", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  for (const q of ["a", "b", "c"]) await session.ask(q);
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(await summaries(app), []);
  assertEquals(sent.at(-1)!.filter((m) => m.role === "user").map((m) => m.content), ["a", "b", "c"]);
}));

Deno.test("ai1.agent.sleep: compacted on request after the next answer, by its user or a superuser", () => withApp(async (app) => {
  const session = await (await Agent.create(app, { system: "lead" })).start(7);
  const compact = (usr: number) => runAs(app, usr, "test", () => app.api["ai1.agent.sleep"].sessions(session.id).compact.post());
  await session.ask("a");
  await assertRejects(() => compact(8), Error, "No such session"); // not bob's
  assertEquals(await compact(7), { ok: true });
  await session.ask("b");
  await new Promise((r) => setTimeout(r, 10));
  assertEquals((await summaries(app)).map((m) => m.summary.from).length, 1); // short, but asked for
  await compact(9); // a superuser may too
  await session.ask("c");
  await new Promise((r) => setTimeout(r, 10));
  assertEquals((await summaries(app)).length, 2);
  await session.ask("d");
  assertEquals(sent.at(-1)!.filter((m) => m.role === "user").map((m) => m.content), ["c", "d"]); // of a, b, c only the last turn is kept
}));
