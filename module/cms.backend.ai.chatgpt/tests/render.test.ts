import { App, html } from "@qino/qino";
import { cms as cmsFor } from "@qino/qino/cms";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { store } from "@qino/m/ai.chatgpt/tests/deps.ts";

import { cms } from "../plugin.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** A real app with ai.chatgpt; the page node is a stand-in, the page only reads its app and form fields. */
async function withPage(fn: (render: (ctx: Ctx, vars?: Record<string, unknown>) => Promise<string>, app: App) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  const app = new App({ db: "sqlite::memory:", dir: dir + "/" });
  const source = app.stores.add(new URL("../../store.json", import.meta.url));
  try {
    await app.init();
    await source.install("ai.chatgpt");
    const node = { app, cms: { formFields: () => html`` } } as unknown as Node;
    // translating needs a full request; the page's words in English do
    Object.defineProperty(app, "t", { value: (s: TemplateStringsArray, ...v: unknown[]) => Promise.resolve(String.raw(s, ...v)) });
    await fn(async (ctx, vars) => String(await cms.node.render(node, { ctx, vars })), app);
  } finally { await app.db.close(); await Deno.remove(dir, { recursive: true }); }
}

const ctxOf = (userId: number, url = "http://127.0.0.1:8080/cms1/backend/ai/chatgpt", superuser = false) => ({
  user: { superuser }, userId, csrfToken: "csrf", res: { headers: new Headers() },
  req: { appUrl: "/cms1/", url: new URL(url) },
}) as unknown as Ctx;

const connect = (app: App, user: number) => store(app, user, { client_id: "oaiapp_test", subject: "sub", email: "user@example.org",
  id_token: "", access_token: "token", refresh_token: "refresh", scopes: [], expires_at: Date.now() + 3600_000 });

Deno.test("AI backend ChatGPT page exposes the sign-in button without a typed URL", () => withPage(async (render, app) => {
  const output = await render(ctxOf(2));
  assertStringIncludes(output, "Continue with ChatGPT");
  assertStringIncludes(output, "/cms1/ai-chatgpt/start?return_to=");
  assertStringIncludes(await render(ctxOf(2, "http://localhost:8080/cms1/backend/ai/chatgpt")),
    "http://127.0.0.1:8080/cms1/backend/ai/chatgpt");
  await connect(app, 2);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.resolve(Response.json({ models: [] }));
    assertStringIncludes(await render(ctxOf(2)), "user@example.org");
  } finally { globalThis.fetch = original; }
}));

Deno.test("AI backend ChatGPT page: only one's own connected plan can answer when no one is signed in", () => withPage(async (render, app) => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(Response.json({ models: [] }));
  try {
    const usr = async () => Number(await app.settings["ai.chatgpt"].usr) || 0;
    assertStringIncludes(await render(ctxOf(2), { fallback: "mine" }), "Connect a ChatGPT account to offer your plan.");
    assertEquals(await usr(), 0, "without an account connected, nothing is offered");
    await connect(app, 2);
    assertStringIncludes(await render(ctxOf(2), { fallback: "mine" }), "Stop using my plan for this");
    assertEquals(await usr(), 2);
    await render(ctxOf(3), { fallback: "none" });
    assertEquals(await usr(), 2, "another user cannot take it back");
    await render(ctxOf(3, undefined, true), { fallback: "none" });
    assertEquals(await usr(), 0, "a superuser can");
  } finally { globalThis.fetch = original; }
}));

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
