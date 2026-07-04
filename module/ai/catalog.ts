import type { Kind } from "./types.ts";

// Catalog of known providers (code, not DB). The backend admin uses it to prefill
// "add provider" — nothing is auto-inserted. Configured providers live in ai_provider.
// Keys are never here; they go to settings (secrets) and stay optional for local endpoints.

export const providerCatalog: {
  name: string;
  endpoint: string;
  timeout_ms?: number;
  models?: { model_id: string; kind: Kind; is_default?: boolean }[];
}[] = [
  {
    name: "groq.com",
    endpoint: "https://api.groq.com/openai/v1",
    models: [{ model_id: "llama-3.3-70b-versatile", kind: "chat", is_default: true }],
  },
  { name: "openai.com", endpoint: "https://api.openai.com/v1" },
  { name: "nvidia.com", endpoint: "https://integrate.api.nvidia.com/v1", timeout_ms: 120000 },
  { name: "openrouter.ai", endpoint: "https://openrouter.ai/api/v1" },
  { name: "aihubmix.com", endpoint: "https://aihubmix.com/v1" },
  {
    name: "jina.ai",
    endpoint: "https://api.jina.ai/v1",
    models: [{ model_id: "jina-embeddings-v3", kind: "embedding", is_default: true }],
  },
  {
    name: "x-ai",
    endpoint: "https://api.x.ai/v1",
    models: [
      { model_id: "grok-imagine-image", kind: "image", is_default: true },
      { model_id: "grok-imagine-image-pro", kind: "image" },
    ],
  },
  { name: "DeepInfra", endpoint: "https://api.deepinfra.com/v1/openai" },
  { name: "Novita", endpoint: "https://api.novita.ai/v3/openai" },
  { name: "Baseten", endpoint: "https://inference.baseten.co/v1" },
  { name: "Fireworks", endpoint: "https://api.fireworks.ai/inference/v1" },
  { name: "Nebius", endpoint: "https://api.studio.nebius.com/v1" },
  { name: "Together AI", endpoint: "https://api.together.xyz/v1" },
  { name: "SambaNova", endpoint: "https://api.sambanova.ai/v1" },
  { name: "Cerebras", endpoint: "https://api.cerebras.ai/v1" },
  { name: "Parasail", endpoint: "https://api.parasail.io/v1" },
  { name: "Scaleway", endpoint: "https://api.scaleway.ai/v1" },
  { name: "Google AI Studio", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai" },
];
