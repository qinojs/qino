import { App } from "@qino/qino";
import { cms as cmsFor } from "@qino/qino/cms";
import { assert, assertStringIncludes } from "@qino/qino/tests";
import { store } from "@qino/m/ai.chatgpt/tests/deps.ts";

import { cms } from "../plugin.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

Deno.test("AI backend ChatGPT page exposes the sign-in button without a typed URL", async () => {
  const dir = await Deno.makeTempDir();
  const app = { modules: { get: () => ({ data: dir + "/" }) },
    t: (strings: TemplateStringsArray) => Promise.resolve(strings[0]) } as unknown as App;
  const node = { app } as Node;
  const ctx = { user: {}, userId: 2, csrfToken: "csrf", res: { headers: new Headers() }, req: {
    appUrl: "/cms1/", url: new URL("http://127.0.0.1:8080/cms1/backend/ai/chatgpt") },
  } as unknown as Ctx;
  try {
    const output = String(await cms.node.render(node, { ctx }));
    assertStringIncludes(output, "Continue with ChatGPT");
    assertStringIncludes(output, "/cms1/ai-chatgpt/start?return_to=");
    const localhost = { ...ctx, req: { ...ctx.req, url: new URL("http://localhost:8080/cms1/backend/ai/chatgpt") } } as unknown as Ctx;
    assertStringIncludes(String(await cms.node.render(node, { ctx: localhost })),
      "http://127.0.0.1:8080/cms1/backend/ai/chatgpt");
    await store(app, 2, { client_id: "oaiapp_test", subject: "sub", email: "user@example.org",
      id_token: "", access_token: "token", refresh_token: "refresh", scopes: [], expires_at: Date.now() + 3600_000 });
    const original = globalThis.fetch;
    try {
      globalThis.fetch = () => Promise.resolve(Response.json({ models: [] }));
      assertStringIncludes(String(await cms.node.render(node, { ctx })), "user@example.org");
    } finally { globalThis.fetch = original; }
  } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test("Installing the ChatGPT backend module creates its navigable AI page", async () => {
  const dir = await Deno.makeTempDir();
  const app = new App({ db: "sqlite::memory:", dir: dir + "/" });
  const source = app.stores.add(new URL("../../store.json", import.meta.url));
  try {
    await app.init();
    await source.install("cms.backend.ai.chatgpt");
    assert(app.modules.linked("cms.backend.ai.chatgpt"));
    assert(await cmsFor(app).nodeByModule("cms.backend.ai.chatgpt"));
  } finally { await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});
