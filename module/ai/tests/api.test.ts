import { assert, assertEquals } from "../../core/tests/deps.ts";
import { invoke, Output, RequestContext, requestStorage, toTools } from "../../core/mod.ts";
import { api } from "../apt.ts";
import { init, name, needs } from "../plugin.ts";

Deno.test("ai: module metadata and apt tools are wired", () => {
  assertEquals(name, "ai");
  assertEquals(needs, ["core"]);
  assertEquals(toTools(api).map((tool) => tool.name), [
    "post_sessions",
    "get_sessions",
    "post_sessions_messages",
    "post_sessions_stream",
    "post_imageGenerations",
  ]);
});

Deno.test("ai: init installs AiApi (no cms coupling)", () => {
  const app = { aptTree: {}, fileTransformer: { registerOcrEngine: () => {}, registerTranscriptEngine: () => {} } };
  init(app as never);
  assertEquals(typeof (app as never as { ai: unknown }).ai, "object");
});

Deno.test("ai: apt execute delegates to app.ai", async () => {
  const ctx = new RequestContext();
  ctx.sess = { data: { liveUser: () => 1 } } as never;
  ctx.app = {
    db: { table: () => ({ entry: () => ({ get: () => false }) }) },
    ai: {
      createSession: (_opts: unknown) => 42,
      session: (id: number) => ({ run: (content: string) => ({ kind: "run", id, content }) }),
    },
  } as never;

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "POST", "/sessions", { bot: "cms-helper" }), { id: 42 });
    assertEquals(await invoke(api, "POST", "/sessions/5/messages", { content: "hi" }), { kind: "run", id: 5, content: "hi" });
  });
});

Deno.test("ai: stream endpoint throws an Output carrying a ReadableStream", async () => {
  const ctx = new RequestContext();
  ctx.sess = { data: { liveUser: () => 1 } } as never;
  ctx.app = {
    db: { table: () => ({ entry: () => ({ get: () => false }) }) },
    ai: { session: () => ({ runStream: () => new ReadableStream() }) },
  } as never;

  await requestStorage.run(ctx, async () => {
    const err = await invoke(api, "POST", "/sessions/5/stream", { content: "hi" }).then(() => null, (e) => e);
    assert(err instanceof Output);
    assert(err.body instanceof ReadableStream);
    assertEquals(err.isJson, false);
  });
});
