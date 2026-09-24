// Known providers to start from. The name is also the key's name in core.keys, so existing keys
// (api.deepl.com, googleapis.com) keep working. `console`: where the key is made.
export const CATALOG: { name: string; type: string; endpoint: string; console?: string }[] = [
  { name: "api.openai.com", type: "openai", endpoint: "https://api.openai.com/v1", console: "https://platform.openai.com/api-keys" },
  { name: "api.anthropic.com", type: "openai", endpoint: "https://api.anthropic.com/v1", console: "https://console.anthropic.com/settings/keys" },
  { name: "generativelanguage.googleapis.com", type: "openai", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", console: "https://aistudio.google.com/apikey" },
  { name: "api.groq.com", type: "openai", endpoint: "https://api.groq.com/openai/v1", console: "https://console.groq.com/keys" },
  { name: "openrouter.ai", type: "openai", endpoint: "https://openrouter.ai/api/v1", console: "https://openrouter.ai/settings/keys" },
  { name: "api.mistral.ai", type: "openai", endpoint: "https://api.mistral.ai/v1", console: "https://console.mistral.ai/api-keys" },
  { name: "api.x.ai", type: "openai", endpoint: "https://api.x.ai/v1" },
  { name: "integrate.api.nvidia.com", type: "openai", endpoint: "https://integrate.api.nvidia.com/v1" },
  { name: "aihubmix.com", type: "openai", endpoint: "https://aihubmix.com/v1" },
  { name: "api.together.xyz", type: "openai", endpoint: "https://api.together.xyz/v1" },
  { name: "api.fireworks.ai", type: "openai", endpoint: "https://api.fireworks.ai/inference/v1" },
  { name: "api.deepinfra.com", type: "openai", endpoint: "https://api.deepinfra.com/v1/openai" },
  { name: "api.cerebras.ai", type: "openai", endpoint: "https://api.cerebras.ai/v1" },
  { name: "api.jina.ai", type: "openai", endpoint: "https://api.jina.ai/v1" },
  { name: "ollama", type: "openai", endpoint: "http://localhost:11434/v1" },
  { name: "api.deepl.com", type: "deepl", endpoint: "https://api.deepl.com/v2", console: "https://www.deepl.com/your-account/keys" },
  { name: "api-free.deepl.com", type: "deepl", endpoint: "https://api-free.deepl.com/v2", console: "https://www.deepl.com/your-account/keys" },
  { name: "googleapis.com", type: "google", endpoint: "https://translation.googleapis.com/language/translate/v2", console: "https://console.cloud.google.com/apis/credentials" },
];
