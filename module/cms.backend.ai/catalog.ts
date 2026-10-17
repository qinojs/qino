// Known providers to start from. The name is also the key's name in core.keys, so existing keys
// (api.deepl.com, googleapis.com) keep working. `console`: where the key is made. `models`: ones its
// /models doesn't list, imported like the listed ones, with a price where no source has one. Prices
// are per million provider-reported units: translation services charge characters. `scores`
// where no benchmark has one: translation services are judged within what they do. `plainIds`: the
// API takes a model without the `org/` its /models puts before it. A model's `name` where its id
// doesn't end in one (fal.ai: elevenlabs/music/v2.5).
// An estimate, not a measurement: translating, DeepL keeps up with the best tenth of the models
// (Artificial Analysis intelligence index 34.6 and up, max 57.6, in 2026-09), Google a little below.
const TRANSLATOR = { deepl: { intelligence: 35 }, google: { intelligence: 30 } };

// fal.ai's music models, the better first: without scores ai keeps this order.
const FAL = [
  ["elevenlabs/music/v2.5", "elevenlabs-music-v2.5"],
  ["google/lyria-3.5", "lyria-3.5"],
  ["fal-ai/minimax-music/v2.6", "minimax-music-2.6"],
  ["minimax/music-3", "minimax-music-3"], // lyrics only
  ["mureka/api/generate/song", "mureka-song"],
  ["fal-ai/stable-audio-3/medium/text-to-audio", "stable-audio-3-medium"], // instrumental
  ["fal-ai/stable-audio-25/text-to-audio", "stable-audio-2.5"], // instrumental
  ["fal-ai/ace-step", "ace-step"],
].map(([id, name]) => ({ id, name, capabilities: ["music"] }));

/** `list`: where it lists all its models, if not at /models and /embeddings/models. */
export const CATALOG: {
  name: string; type: string; endpoint: string; console?: string; plainIds?: boolean; list?: string;
  models?: { id: string; name?: string; capabilities: string[]; cost?: { input: number; output: number }; scores?: Record<string, number> }[];
}[] = [
  { name: "api.openai.com", type: "openai", endpoint: "https://api.openai.com/v1", console: "https://platform.openai.com/api-keys" },
  { name: "api.anthropic.com", type: "openai", endpoint: "https://api.anthropic.com/v1", console: "https://console.anthropic.com/settings/keys" },
  { name: "generativelanguage.googleapis.com", type: "gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", console: "https://aistudio.google.com/apikey",
    models: [{ id: "models/lyria-3.5", capabilities: ["music"] }] }, // its /models doesn't tell what a model does
  { name: "api.groq.com", type: "openai", endpoint: "https://api.groq.com/openai/v1", console: "https://console.groq.com/keys" },
  { name: "openrouter.ai", type: "openrouter", endpoint: "https://openrouter.ai/api/v1", console: "https://openrouter.ai/settings/keys", list: "/models?output_modalities=all" }, // else only text output
  { name: "api.mistral.ai", type: "openai", endpoint: "https://api.mistral.ai/v1", console: "https://console.mistral.ai/api-keys" },
  { name: "api.x.ai", type: "openai", endpoint: "https://api.x.ai/v1" },
  { name: "integrate.api.nvidia.com", type: "nvidia", endpoint: "https://integrate.api.nvidia.com/v1" },
  { name: "aihubmix.com", type: "openai", endpoint: "https://aihubmix.com/v1" },
  { name: "tokenharbor.ai", type: "openai", endpoint: "https://tokenharbor.ai/v1", console: "https://tokenharbor.ai/dashboard" },
  { name: "api.together.xyz", type: "openai", endpoint: "https://api.together.xyz/v1" },
  { name: "api.fireworks.ai", type: "openai", endpoint: "https://api.fireworks.ai/inference/v1" },
  { name: "api.deepinfra.com", type: "openai", endpoint: "https://api.deepinfra.com/v1/openai" },
  { name: "api.cerebras.ai", type: "openai", endpoint: "https://api.cerebras.ai/v1" },
  { name: "api.deepseek.com", type: "openai", endpoint: "https://api.deepseek.com/v1", console: "https://platform.deepseek.com/api_keys" },
  { name: "dashscope-intl.aliyuncs.com", type: "openai", endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", console: "https://modelstudio.console.alibabacloud.com/" },
  { name: "api.moonshot.ai", type: "openai", endpoint: "https://api.moonshot.ai/v1", console: "https://platform.moonshot.ai/console/api-keys" },
  { name: "api.z.ai", type: "openai", endpoint: "https://api.z.ai/api/paas/v4", console: "https://z.ai/manage-apikey/apikey-list" },
  { name: "api.cohere.ai", type: "openai", endpoint: "https://api.cohere.ai/compatibility/v1", console: "https://dashboard.cohere.com/api-keys" },
  { name: "api.perplexity.ai", type: "openai", endpoint: "https://api.perplexity.ai", console: "https://www.perplexity.ai/account/api/keys", list: "/v1/models" }, // chat at /chat/completions
  { name: "router.huggingface.co", type: "openai", endpoint: "https://router.huggingface.co/v1", console: "https://huggingface.co/settings/tokens" },
  { name: "api.jina.ai", type: "jina", endpoint: "https://api.jina.ai/v1", console: "https://jina.ai/api-dashboard/key-manager", plainIds: true }, // jina-ai/jina-embeddings-v3 is jina-embeddings-v3
  { name: "ollama", type: "openai", endpoint: "http://localhost:11434/v1" },
  { name: "api.deepl.com", type: "deepl", endpoint: "https://api.deepl.com/v2", console: "https://www.deepl.com/your-account/keys", models: [{ id: "deepl", capabilities: ["translate"], cost: { input: 20, output: 0 }, scores: TRANSLATOR.deepl }] }, // ~$20 per million characters
  { name: "api-free.deepl.com", type: "deepl", endpoint: "https://api-free.deepl.com/v2", console: "https://www.deepl.com/your-account/keys", models: [{ id: "deepl", capabilities: ["translate"], cost: { input: 0, output: 0 }, scores: TRANSLATOR.deepl }] }, // 500,000 characters a month
  { name: "googleapis.com", type: "google", endpoint: "https://translation.googleapis.com/language/translate/v2", console: "https://console.cloud.google.com/apis/credentials", models: [{ id: "google-translate", capabilities: ["translate"], cost: { input: 20, output: 0 }, scores: TRANSLATOR.google }] }, // $20 per million characters
  { name: "fal.ai", type: "fal", endpoint: "https://queue.fal.run", console: "https://fal.ai/dashboard/keys", models: FAL },
];
