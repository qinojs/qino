// Known providers to start from. The name is also the key's name in core.keys, so existing keys
// (api.deepl.com, googleapis.com) keep working. `console`: where the key is made. `models`: ones its
// /models doesn't list, imported like the listed ones, with a price where no source has one. Per
// million tokens like the models': translation services charge characters, a token is ~4. `scores`
// where no benchmark has one: translation services are judged within what they do. `plainIds`: the
// API takes a model without the `org/` its /models puts before it.
// An estimate, not a measurement: translating, DeepL keeps up with the best tenth of the models
// (Artificial Analysis intelligence index 34.6 and up, max 57.6, in 2026-09), Google a little below.
const TRANSLATOR = { deepl: { intelligence: 35 }, google: { intelligence: 30 } };

export const CATALOG: {
  name: string; type: string; endpoint: string; console?: string; plainIds?: boolean;
  models?: { id: string; capabilities: string[]; cost?: number; scores?: Record<string, number> }[];
}[] = [
  { name: "api.openai.com", type: "openai", endpoint: "https://api.openai.com/v1", console: "https://platform.openai.com/api-keys" },
  { name: "api.anthropic.com", type: "openai", endpoint: "https://api.anthropic.com/v1", console: "https://console.anthropic.com/settings/keys" },
  { name: "generativelanguage.googleapis.com", type: "openai", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", console: "https://aistudio.google.com/apikey" },
  { name: "api.groq.com", type: "openai", endpoint: "https://api.groq.com/openai/v1", console: "https://console.groq.com/keys" },
  { name: "openrouter.ai", type: "openrouter", endpoint: "https://openrouter.ai/api/v1", console: "https://openrouter.ai/settings/keys", models: [{ id: "typesafe/jev-1.13", capabilities: ["decide"], cost: 0.036 }] }, // Jev: $0.0000156 for 434 tokens on a call
  { name: "api.mistral.ai", type: "openai", endpoint: "https://api.mistral.ai/v1", console: "https://console.mistral.ai/api-keys" },
  { name: "api.x.ai", type: "openai", endpoint: "https://api.x.ai/v1" },
  { name: "integrate.api.nvidia.com", type: "nvidia", endpoint: "https://integrate.api.nvidia.com/v1" },
  { name: "aihubmix.com", type: "openai", endpoint: "https://aihubmix.com/v1" },
  { name: "api.together.xyz", type: "openai", endpoint: "https://api.together.xyz/v1" },
  { name: "api.fireworks.ai", type: "openai", endpoint: "https://api.fireworks.ai/inference/v1" },
  { name: "api.deepinfra.com", type: "openai", endpoint: "https://api.deepinfra.com/v1/openai" },
  { name: "api.cerebras.ai", type: "openai", endpoint: "https://api.cerebras.ai/v1" },
  { name: "api.jina.ai", type: "jina", endpoint: "https://api.jina.ai/v1", console: "https://jina.ai/api-dashboard/key-manager", plainIds: true }, // jina-ai/jina-embeddings-v3 is jina-embeddings-v3
  { name: "ollama", type: "openai", endpoint: "http://localhost:11434/v1" },
  { name: "api.deepl.com", type: "deepl", endpoint: "https://api.deepl.com/v2", console: "https://www.deepl.com/your-account/keys", models: [{ id: "deepl", capabilities: ["translate"], cost: 80, scores: TRANSLATOR.deepl }] }, // ~$20 per million characters
  { name: "api-free.deepl.com", type: "deepl", endpoint: "https://api-free.deepl.com/v2", console: "https://www.deepl.com/your-account/keys", models: [{ id: "deepl", capabilities: ["translate"], cost: 0, scores: TRANSLATOR.deepl }] }, // 500,000 characters a month
  { name: "googleapis.com", type: "google", endpoint: "https://translation.googleapis.com/language/translate/v2", console: "https://console.cloud.google.com/apis/credentials", models: [{ id: "google-translate", capabilities: ["translate"], cost: 80, scores: TRANSLATOR.google }] }, // $20 per million characters
];
