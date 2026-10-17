// deno-lint-ignore-file no-explicit-any
import { App, requestStorage, runAs } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";
import { Agent } from "@qino/qino/ai.agent";

import { apply, sleep } from "../lib/agent.sleep.ts";

import type { Adapter } from "@qino/qino/ai";

// Chats answer "ok". A thinker finds the rule the user gave (with the message it was said in), and one
// it made up (evidence that isn't there); the merger adds what was found, merges the two memories
// about the logo and forgets the wrong one. Both are answered at once: the fake has no batch API.
const prompts: string[] = [];
const fake: Adapter = {
  text: () => Promise.resolve({ text: "ok", toolCalls: [], truncated: false }),
  structured: (_call, { messages }) => {
    const [system, user] = messages.map((m: any) => String(m.content));
    prompts.push(system);
    if (system.includes("thinkers") || system.includes("A thinker")) {
      const memory = (text: string) => Number(system.match(new RegExp(`\\[(\\d+)\\] [\\d.]+ ${text}`))?.[1]);
      const session = Number(user.match(/## Session (\d+)/)![1]);
      return Promise.resolve({
        add: user.includes("always answer in German") ? [{ content: "always answer in German", session }] : [],
        merge: memory("logo: blue") ? [{ ids: [memory("the logo is blue"), memory("logo: blue")], content: "the logo is blue" }] : [],
        strengthen: [], weaken: [], forget: memory("the sky is green") ? [memory("the sky is green")] : [],
      });
    }
    const said = Number(user.match(/\[#(\d+) user\] please always answer in German/)?.[1]);
    return Promise.resolve({
      missed: [{ content: "always answer in German", evidence: [said] }, { content: "made up", evidence: [99999] }],
      confirmed: [], outdated: [],
    });
  },
};

async function withApp(fn: (app: App) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai", "ai.tools", "cron", "score", "ai.embed", "ai.discover", "ai.agent", "ai.agent.sleep"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  app.modules.get("ai")!.plugin.aiAdapters.fake = fake;
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai_model").insert({ name: "m", context_length: 100000 });
    await app.db.table("ai_model_provider").insert({ model_id: 1, provider_id: 1 });
    for (const capability of ["text", "tools", "structured"]) await app.db.table("ai_model_capability").insert({ model_id: 1, capability });
    await app.settings["ai.agent.sleep"].minChars(10); // the short talks here are enough
    await fn(app);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes later
    delete app.modules.get("ai")!.plugin.aiAdapters.fake;
    await app.db.close();
  }
}

/** The night's stage, once the background is done. */
async function stage(app: App, wanted: string) {
  for (let i = 0; i < 100; i++) {
    const now = await app.db.one`SELECT stage FROM ai_agent_sleep ORDER BY id DESC LIMIT 1`;
    if (now === wanted) return now;
    await new Promise((r) => setTimeout(r, 10));
  }
  return await app.db.one`SELECT stage FROM ai_agent_sleep ORDER BY id DESC LIMIT 1`;
}

const contents = (app: App) => app.db.col`SELECT content FROM ai_agent_memory ORDER BY id`;

Deno.test("ai.agent.sleep: at night what was said is gone over; the plan waits to be applied", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "brand designer" });
  for (const content of ["the logo is blue", "logo: blue", "the sky is green"]) await runAs(app, 7, "test", () => agent.remember(content));
  const session = await agent.start(7);
  await session.ask("please always answer in German");
  await new Promise((r) => setTimeout(r, 60));

  await sleep(app);
  assertEquals(await stage(app, "planned"), "planned");
  const thought = JSON.parse(String(await app.db.one`SELECT output FROM ai_agent_sleep_thought`));
  assertEquals(thought.missed.map((t: any) => t.content), ["always answer in German"]); // what has no evidence is dropped
  assertEquals(await contents(app), ["the logo is blue", "logo: blue", "the sky is green"]); // not applied yet

  const [first] = (await app.db.col`SELECT id FROM ai_agent_memory ORDER BY id`).map(Number);
  await apply(app, Number(await app.db.one`SELECT id FROM ai_agent_sleep`));
  assertEquals(await contents(app), ["the logo is blue", "always answer in German"]); // merged into the first, wrong one forgotten
  assertEquals(Number(await app.db.one`SELECT score FROM score_ai_agent_memory_use WHERE memory_id = ${first}`) > 0, true);
  assertEquals(await stage(app, "applied"), "applied");

  // the next night starts after what was gone over: nothing new, no night
  await sleep(app);
  assertEquals(await app.db.one`SELECT COUNT(*) FROM ai_agent_sleep`, 1);
}));

Deno.test("ai.agent.sleep: the role is the yardstick of thinker and merger", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "brand designer" });
  await (await agent.start(7)).ask("please always answer in German");
  await new Promise((r) => setTimeout(r, 60));
  prompts.length = 0;
  await sleep(app);
  await stage(app, "planned");
  assertEquals(prompts.length, 2); // one thinker, one merger
  for (const prompt of prompts) assertEquals(prompt.includes("<role>\nbrand designer\n</role>"), true);
}));

Deno.test("ai.agent.sleep: one agent can be sent to sleep alone; without new messages none sleeps", () => withApp(async (app) => {
  const [talked, silent] = [await Agent.create(app, { system: "a" }), await Agent.create(app, { system: "b" })];
  await (await talked.start(7)).ask("hello");
  await new Promise((r) => setTimeout(r, 60));
  assertEquals(await sleep(app, silent.id), 0);
  assertEquals(await sleep(app, talked.id), 1);
  assertEquals(await app.db.col`SELECT agent_id FROM ai_agent_sleep`, [talked.id]);
  await stage(app, "planned");
}));

Deno.test("ai.agent.sleep: at night an agent sleeps only once enough was said", () => withApp(async (app) => {
  await app.settings["ai.agent.sleep"].minChars(2000);
  const agent = await Agent.create(app, { system: "a" });
  const session = await agent.start(7);
  await session.ask("hello");
  await new Promise((r) => setTimeout(r, 60));
  assertEquals(await sleep(app), 0); // too little: it waits for more
  await session.ask("x".repeat(2000));
  await new Promise((r) => setTimeout(r, 60));
  assertEquals(await sleep(app), 1); // the earlier "hello" counts too
  await stage(app, "planned");
}));

Deno.test("ai.agent.sleep: a night no thinker answered failed, and the next goes over the same", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "a" });
  await (await agent.start(7)).ask("please always answer in German");
  await new Promise((r) => setTimeout(r, 60));
  const structured = fake.structured;
  fake.structured = () => Promise.reject(new Error("down"));
  try {
    await sleep(app);
    assertEquals(await stage(app, "failed"), "failed");
  } finally {
    fake.structured = structured;
  }
  assertEquals(await sleep(app), 1); // the same sessions again
  assertEquals(await stage(app, "planned"), "planned");
}));

Deno.test("ai.agent.sleep: the models run as who started the night, as a ChatGPT plan needs", () => withApp(async (app) => {
  const agent = await Agent.create(app, { system: "a" });
  await (await agent.start(7)).ask("please always answer in German");
  await new Promise((r) => setTimeout(r, 60));
  const structured = fake.structured, users: unknown[] = [];
  fake.structured = (call, input) => (users.push(requestStorage.getStore()?.userId), structured(call, input));
  try {
    await runAs(app, 7, "test", () => sleep(app));
    await stage(app, "planned");
  } finally {
    fake.structured = structured;
  }
  assertEquals(users, [7, 7]); // thinker and merger
}));
