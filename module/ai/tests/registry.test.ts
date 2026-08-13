import { assertEquals, assertRejects } from "@qino/qino/tests";
import { resolve } from "../lib/registry.ts";

// Minimal db stub: routes the two registry queries by their SQL text.
function mockApp(providers: unknown[], models: unknown[]) {
  return {
    db: {
      query: (strings: TemplateStringsArray) =>
        Promise.resolve(strings.join("").includes("ai_provider_model") ? models : providers),
    },
  } as never;
}

const groq = { id: 1, name: "groq.com", endpoint: "g", timeout_ms: 60000 };
const jina = { id: 2, name: "jina.ai", endpoint: "j", timeout_ms: 60000 };

Deno.test("resolve: picks the default model for a kind (is_default ordered first)", async () => {
  const app = mockApp([groq, jina], [
    { id: 11, provider_id: 1, model_id: "llama", kind: "chat", is_default: 1 },
    { id: 12, provider_id: 1, model_id: "other", kind: "chat", is_default: 0 },
  ]);
  const { provider, model } = await resolve(app, { kind: "chat" });
  assertEquals(provider.name, "groq.com");
  assertEquals(model?.model_id, "llama");
});

Deno.test("resolve: honours explicit provider + model", async () => {
  const app = mockApp([groq, jina], [
    { id: 21, provider_id: 2, model_id: "jina-embeddings-v3", kind: "embedding", is_default: 1 },
  ]);
  const { provider, model } = await resolve(app, { provider: "jina.ai", model: "jina-embeddings-v3", kind: "embedding" });
  assertEquals(provider.name, "jina.ai");
  assertEquals(model?.model_id, "jina-embeddings-v3");
});

Deno.test("resolve: unknown provider throws", async () => {
  const app = mockApp([groq], []);
  await assertRejects(() => resolve(app, { provider: "nope", kind: "chat" }), Error, "Unknown provider");
});
