import { App, Redirect } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import { authorize, models, pending, store } from "../lib/account.ts";
import { input } from "../lib/response.ts";
import { init } from "../plugin.ts";

import type { Ctx } from "@qino/qino";

Deno.test("ChatGPT authorization uses dynamic registration, PKCE, and a stable host ID", async () => {
  const attempt = pending(3, "dynamic_agent_client", "http://127.0.0.1:8000/ai1-chatgpt/callback", "/my/chatgpt");
  const url = new URL(await authorize(attempt, "urn:uuid:sample", "Qino"));
  assertEquals(url.origin, "https://auth.openai.com");
  assertEquals(url.searchParams.get("client_id"), "dynamic_agent_client");
  assertEquals(url.searchParams.get("code_challenge_method"), "S256");
  assertEquals(url.searchParams.get("ext_agent_host_id"), "urn:uuid:sample");
  assertEquals(url.searchParams.get("state"), attempt.state);
  assertEquals(url.searchParams.get("nonce"), attempt.nonce);
  assertEquals(url.searchParams.get("resource"), "https://api.openai.com/v1");
});

Deno.test("ChatGPT Responses history keeps function calls and tool results", () => {
  const value = input([
    { role: "system", content: "Be brief" },
    { role: "user", content: "Calculate" },
    { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "sum", args: { a: 1, b: 2 } }] },
    { role: "tool", id: "call-1", content: "3" },
  ], [{ name: "sum", description: "Add", parameters: { type: "object" } }]);
  assertEquals(value.instructions, "Be brief");
  assertEquals(value.input[0].type, "additional_tools");
  assertEquals(value.input[2], { type: "function_call", call_id: "call-1", name: "sum", arguments: '{"a":1,"b":2}' });
  assertEquals(value.input[3], { type: "function_call_output", call_id: "call-1", output: "3" });
});

Deno.test("ChatGPT model catalog uses the plan-specific models array and slugs", async () => {
  const dir = await Deno.makeTempDir();
  const app = new App({ db: "sqlite::memory:", dir: dir + "/" });
  const source = app.stores.add(new URL("../../store.json", import.meta.url));
  const original = globalThis.fetch;
  try {
    await app.init();
    await source.install("ai1.chatgpt");
    const api = await app.db.table("ai1_provider").insert({ name: "api.openai.com", type: "openai", endpoint: "https://api.openai.com/v1" });
    const known = await app.db.table("ai1_model").insert({ name: "available" });
    await app.db.table("ai1_model_provider").insert({ model_id: known, provider_id: api, cost_input: 2 });
    await store(app, 3, { client_id: "oaiapp_test", subject: "sub", email: "", id_token: "",
      access_token: "token", refresh_token: "refresh", scopes: ["chatgpt.tokens.use.direct"], expires_at: Date.now() + 3600_000 });
    globalThis.fetch = (_url, init) => {
      assertEquals(new Headers(init?.headers).get("authorization"), "Bearer token");
      return Promise.resolve(Response.json({ models: [
        { slug: "available", visibility: "list" }, { slug: "hidden", visibility: "hidden" },
      ] }));
    };
    assertEquals(await models(app, 3), ["available"]);
    assertEquals(await app.db.query`SELECT m.name, p.name AS provider FROM ai1_model_provider mp
      JOIN ai1_model m ON m.id = mp.model_id JOIN ai1_provider p ON p.id = mp.provider_id ORDER BY p.name`, [
      { name: "available", provider: "api.openai.com" }, { name: "available", provider: "chatgpt-plan" },
    ]);
    assertEquals(await app.db.one`SELECT cost_input FROM ai1_model_provider WHERE provider_id = ${api}`, 2);
    assertEquals(await app.db.col`SELECT capability FROM ai1_model_capability`, ["text"]);
    await models(app, 3);
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM ai1_model_provider`), 2);
  } finally { globalThis.fetch = original; await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});

Deno.test("ChatGPT module ensures its own provider alongside the API-key provider", async () => {
  const dir = await Deno.makeTempDir();
  const app = new App({ db: "sqlite::memory:", dir: dir + "/" });
  const source = app.stores.add(new URL("../../store.json", import.meta.url));
  try {
    await app.init();
    await source.install("ai1");
    await app.db.table("ai1_provider").insert({ name: "api.openai.com", type: "openai", endpoint: "https://api.openai.com/v1" });
    await source.install("ai1.chatgpt");
    assertEquals(await app.db.query`SELECT name, type, endpoint FROM ai1_provider ORDER BY name`, [
      { name: "api.openai.com", type: "openai", endpoint: "https://api.openai.com/v1" },
      { name: "chatgpt-plan", type: "chatgpt-plan", endpoint: "https://api.openai.com/v1" },
    ]);
    await app.modules.repair("ai1.chatgpt");
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM ai1_provider WHERE name = ${"chatgpt-plan"}`), 1);
    app.modules.unlink("ai1.chatgpt");
    await app.db.exec`DELETE FROM ai1_provider WHERE name = ${"chatgpt-plan"}`;
    await app.modules.link("ai1.chatgpt");
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM ai1_provider WHERE name = ${"chatgpt-plan"}`), 1);
    app.modules.unlink("ai1.chatgpt");
    await app.db.exec`UPDATE ai1_provider SET type = ${"openai"} WHERE name = ${"chatgpt-plan"}`;
    await assertRejects(() => app.modules.link("ai1.chatgpt"), Error, 'Provider "chatgpt-plan" already exists');
  } finally { await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});

Deno.test("ChatGPT account actions return to the same Qino app, never another site", async () => {
  const dir = await Deno.makeTempDir();
  const original = globalThis.fetch;
  let route: (event: { ctx: Ctx }) => unknown = () => {};
  const app = { modules: { get: () => ({ data: dir + "/" }) }, db: {
    row: () => Promise.resolve({ type: "chatgpt-plan", endpoint: "https://api.openai.com/v1" }),
  },
    on: (_name: string, listener: typeof route) => { route = listener; } } as unknown as App;
  const body = { csrf: "csrf", client_id: "oaiapp_test", return_to: "/cms1/account" };
  const ctx = { app, userId: 3, csrfToken: "csrf", req: {
    method: "POST", appPath: "ai1-chatgpt/select", appUrl: "/cms1/",
    url: new URL("http://127.0.0.1:8080/cms1/ai1-chatgpt/select"), body,
  } } as unknown as Ctx;
  try {
    globalThis.fetch = () => Promise.resolve(Response.json({ models: [] }));
    await store(app, 3, { client_id: "oaiapp_test", subject: "sub", email: "",
      id_token: "", access_token: "token", refresh_token: "refresh", scopes: [], expires_at: Date.now() + 3600_000 });
    await init(app, { signal: new AbortController().signal });
    const redirect = async () => {
      try { await route({ ctx }); } catch (e) { if (e instanceof Redirect) return e.buildHeaders().get("Location"); throw e; }
      throw new Error("Expected a redirect");
    };
    assertEquals(await redirect(), "/cms1/account");
    body.return_to = "//elsewhere.example/steal";
    assertEquals(await redirect(), "/cms1/ai1-chatgpt");
  } finally { globalThis.fetch = original; await Deno.remove(dir, { recursive: true }); }
});
