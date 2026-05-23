import { assertEquals } from "../../core/tests/deps.ts";
import { parseProviderModels, providerModels } from "../lib/providerModels.ts";

Deno.test("ai: parseProviderModels accepts JSON and normalizes model fields", () => {
  assertEquals(parseProviderModels(JSON.stringify([
    {
      id: " custom-model ",
      label: "Custom",
      description: "A model",
      strengths: [" quality ", "", "speed"],
      maxInputTokens: "4096",
      maxOutputTokens: 0,
      costPerMToken: "0",
      inputCostPerMToken: "0.25",
      outputCostPerMToken: "0.75",
      supports: { tools: true },
    },
    { id: "" },
    null,
  ])), [{
    id: "custom-model",
    label: "Custom",
    description: "A model",
    strengths: ["quality", "speed"],
    maxInputTokens: 4096,
    costPerMToken: 0,
    inputCostPerMToken: 0.25,
    outputCostPerMToken: 0.75,
    supports: { tools: true },
  }]);
});

Deno.test("ai: parseProviderModels rejects invalid input without throwing", () => {
  assertEquals(parseProviderModels("not json"), []);
  assertEquals(parseProviderModels({ id: "x" }), []);
  assertEquals(parseProviderModels(undefined), []);
});

Deno.test("ai: providerModels merges built-in and custom models by id", async () => {
  const app = {
    settings: {
      ai: {
        provider: {
          "jina.ai": {
            models: JSON.stringify([
              { id: "jina-embeddings-v3", label: "Custom Jina 3" },
              { id: "custom-jina", label: "Custom Jina" },
            ]),
          },
        },
      },
    },
  };

  const models = await providerModels(app as never, "jina.ai");
  const byId = new Map(models.map((model) => [model.id, model]));
  assertEquals(byId.get("jina-embeddings-v3")?.label, "Custom Jina 3");
  assertEquals(byId.get("custom-jina")?.label, "Custom Jina");
  assertEquals(models.length >= 5, true);
});

Deno.test("ai: providerModels returns empty list for unknown providers", async () => {
  assertEquals(await providerModels({ settings: { ai: { provider: {} } } } as never, "missing"), []);
});
