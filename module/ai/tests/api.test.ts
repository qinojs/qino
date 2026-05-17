import { assertEquals } from "../../core/tests/deps.ts";
import { invoke, toTools } from "../../core/lib/apt/mod.ts";
import { RequestContext, requestStorage } from "../../core/lib/RequestContext.ts";
import { api } from "../apt.ts";
import { init, name, needs } from "../mod.ts";

Deno.test("ai: module metadata and apt tools are wired", () => {
  assertEquals(name, "ai");
  assertEquals(needs, ["core"]);
  assertEquals(toTools(api).map((tool) => tool.name), [
    "post_chatCompletions",
    "post_chatSession",
    "post_embeddings",
    "post_imageGenerations",
  ]);
});

Deno.test("ai: init installs AiApi, apt tree and cms-ready hook", () => {
  const handlers: Record<string, Function[]> = {};
  const app = {
    aptTree: {},
    on(name: string, fn: Function) {
      (handlers[name] ??= []).push(fn);
    },
  };
  init(app);
  assertEquals(typeof (app as never as { ai: unknown }).ai, "object");
  assertEquals((app.aptTree as never as Record<string, unknown>).ai, api);

  const ctx = {
    state: { editmode: true },
    sysURL: "/m/",
    html: { content: "", addJSM(url: string) { this.content += `[${url}]`; } },
  };
  handlers["cms-ready"][0]({ ctx });
  assertEquals(ctx.html.content.includes("[/m/ai/pub/chat.js]"), true);
  assertEquals(ctx.html.content.includes('<ai-chat bot="cms-helper"></ai-chat>'), true);
});

Deno.test("ai: apt execute delegates to app.ai methods", async () => {
  const ctx = new RequestContext();
  ctx.session = { liveUser: () => 1 } as never;
  ctx.app = {
    db: { table: () => ({ Entry: () => ({ get: () => false }) }) },
    ai: {
      chatCompletions: (data: unknown) => ({ kind: "chat", data }),
      chatSession: (data: unknown) => ({ kind: "session", data }),
      embeddings: (data: unknown) => ({ kind: "embeddings", data }),
      imageGenerations: (data: unknown) => ({ kind: "image", data }),
    },
  } as never;

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "POST", "/chat-completions", { data: { a: 1 } }), { kind: "chat", data: { a: 1 } });
    assertEquals(await invoke(api, "POST", "/chat-session", { data: { b: 2 } }), { kind: "session", data: { b: 2 } });
    assertEquals(await invoke(api, "POST", "/embeddings", { data: { c: 3 } }), { kind: "embeddings", data: { c: 3 } });
    assertEquals(await invoke(api, "POST", "/image-generations", { data: { d: 4 } }), { kind: "image", data: { d: 4 } });
  });
});
