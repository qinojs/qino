// deno-lint-ignore-file no-explicit-any
import { providers } from "./providers.ts";

export async function imageGenerations(data: Record<string, unknown>, app: any): Promise<any> {
  const providerName = String(data._provider ?? "x-ai");
  const provider = providers[providerName];
  if (!provider) return { error: `Unknown provider: ${providerName}` };

  const key = String(await app.settings.ai.provider[providerName].key ?? "");
  if (!key) return { error: `No API key for provider "${providerName}"` };

  const postData: Record<string, unknown> = { ...data };
  delete postData._provider;
  postData.model ||= "grok-imagine-image";
  postData.n ||= 1;

  const response = await fetch(provider.endpoint + "/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": "Bearer " + key },
    body: JSON.stringify(postData),
    signal: AbortSignal.timeout(provider.timeoutMs ?? 60000),
  });

  const text = await response.text();
  try { return JSON.parse(text); } catch { /* not json */ }
  return { error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
}
