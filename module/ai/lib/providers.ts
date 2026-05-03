import type { ProviderConf } from "../types.ts";

export const providers: Record<string, ProviderConf> = {
  "groq.com": {
    endpoint: "https://api.groq.com/openai/v1",
    jsonMode: true,
    supports: { tools: true, toolChoiceAuto: true, jsonMode: true },
    strengths: ["speed", "cost"],
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      {
        id: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B Versatile",
        strengths: ["speed", "multilingual", "cost"],
        supports: { tools: true, toolChoiceAuto: true, jsonMode: true },
      },
    ],
  },
  "openai.com": {
    endpoint: "https://api.openai.com/v1",
    jsonMode: true,
    supports: { tools: true, toolChoiceAuto: true, jsonMode: true },
    strengths: ["reasoning", "quality"],
    models: [],
  },
  "nvidia.com": {
    endpoint: "https://integrate.api.nvidia.com/v1",
    timeoutMs: 120000,
    strengths: ["speed", "quality"],
    models: [],
  },
  "openrouter.ai": {
    endpoint: "https://openrouter.ai/api/v1",
    jsonMode: true,
    supports: { tools: true, toolChoiceAuto: true, jsonMode: true },
    strengths: ["routing", "model-choice"],
    models: [],
  },
  "jina.ai": {
    endpoint: "https://api.jina.ai/v1",
    strengths: ["cost", "embedding"],
    embeddingModel: "jina-embeddings-v3",
    models: [
      {
        id: "jina-embeddings-v3",
        label: "Jina Embeddings v3",
        strengths: ["multilingual", "cost"],
        maxInputTokens: 8192,
        supports: {},
      },
      {
        id: "jina-embeddings-v4",
        label: "Jina Embeddings v4",
        strengths: ["multilingual", "vision"],
        maxInputTokens: 32768,
        supports: { vision: true },
      },
      {
        id: "jina-embeddings-v5-text-small",
        label: "Jina Embeddings v5 Text Small",
        strengths: ["multilingual", "long-context"],
        maxInputTokens: 32768,
        supports: {},
      },
      {
        id: "jina-embeddings-v5-text-nano",
        label: "Jina Embeddings v5 Text Nano",
        strengths: ["cost", "speed"],
        maxInputTokens: 8192,
        supports: {},
      },
    ],
  },
};
