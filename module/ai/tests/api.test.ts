import { assert, assertEquals, testContext } from "@qino/qino/tests";
import { invoke, Output, requestStorage, toTools } from "@qino/qino";
import { api } from "../api.ts";
import { ai, AiApi } from "../mod.ts";
import { aiInstances } from "../lib/AiApi.ts";
import { init } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name, dependencies } = manifest;

Deno.test("ai: module metadata and api tools are wired", () => {
  assertEquals(name, "ai");
  assertEquals(dependencies, ["core"]);
  assertEquals(toTools(api).map((tool) => tool.name), [
    "post_sessions",
    "get_sessions",
    "post_sessions_messages",
    "post_sessions_stream",
    "post_imageGenerations",
  ]);
});

Deno.test("ai: init installs AiApi (no cms coupling)", () => {
  const app = { apiTree: {}, fileTransformer: { registerOcrEngine: () => {}, registerTranscriptEngine: () => {} } };
  init(app as never);
  assert(ai(app as never) instanceof AiApi);
});

Deno.test("ai: api execute delegates to the app's ai instance", async () => {
  const ctx = await testContext({ userId: 1, app: {
    db: { table: () => ({ row: () => ({ superuser: false }) }) },
  } });
  aiInstances.set(ctx.app, {
    createSession: (_opts: unknown) => 42,
    session: (id: number) => ({ run: (content: string) => ({ kind: "run", id, content }) }),
  } as never);

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "POST", "/sessions", { bot: "cms-helper" }), { id: 42 });
    assertEquals(await invoke(api, "POST", "/sessions/5/messages", { content: "hi" }), { kind: "run", id: 5, content: "hi" });
  });
});

Deno.test("ai: stream endpoint throws an Output carrying a ReadableStream", async () => {
  const ctx = await testContext({ userId: 1, app: {
    db: { table: () => ({ row: () => ({ superuser: false }) }) },
  } });
  aiInstances.set(ctx.app, { session: () => ({ runStream: () => new ReadableStream() }) } as never);

  await requestStorage.run(ctx, async () => {
    const err = await invoke(api, "POST", "/sessions/5/stream", { content: "hi" }).then(() => null, (e) => e);
    assert(err instanceof Output);
    assert(err.body instanceof ReadableStream);
    assertEquals(err.isJson, false);
  });
});
