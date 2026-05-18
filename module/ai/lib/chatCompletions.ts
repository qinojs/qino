// deno-lint-ignore-file no-explicit-any
import { providerModels } from "./providerModels.ts";
import { providers } from "./providers.ts";

export async function chatCompletions(data: Record<string, unknown>, app: any): Promise<any> {
  const defaultProviderName = String(await app.settings.ai.default.provider ?? "");
  const providerName = String(data._provider ?? defaultProviderName);

  const provider = providers[providerName];
  if (!provider) return { error: `Unknown provider: ${providerName}` };

  const providerSettings = app.settings.ai.provider[providerName];
  const key = String(await providerSettings.key ?? "");
  if (!key) {
    return {
      error: `No API key configured for provider "${providerName}". Please add it in the CMS settings.`,
    };
  }

  const postData: Record<string, unknown> = { ...data };
  delete postData._provider;

  if (postData.model === undefined) {
    const defaultModel = String(await app.settings.ai.default.model ?? "");
    const providerDefaultModel = String(await providerSettings.default_model ?? "");
    const firstProviderModel =
      (await providerModels(app, providerName))[0]?.id ?? "";
    postData.model = providerName === defaultProviderName
      ? defaultModel || providerDefaultModel || provider.defaultModel || firstProviderModel
      : providerDefaultModel || provider.defaultModel || firstProviderModel || defaultModel;
  }
  postData.temperature ??= 0.6;
  postData.max_tokens ??= 5512;
  postData.top_p ??= 1;
  postData.n ??= 1;
  postData.stream = false;

  let response: Response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(provider.endpoint + "/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": "Bearer " + key,
        },
        body: JSON.stringify(postData),
        signal: AbortSignal.timeout(provider.timeoutMs ?? 60000),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return {
          error: `Provider "${providerName}" timed out after ${Math.round((provider.timeoutMs ?? 60000) / 1000)}s.`,
        };
      }
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (response.status !== 429) break;
    const retryAfter = parseFloat(response.headers.get("retry-after") ?? "1");
    if (response.headers.get("x-should-retry") === "false" || retryAfter > 30) {
      break;
    }
    await new Promise((r) => setTimeout(r, Math.ceil(retryAfter * 1000) + 100));
  }

  let result: any;
  try { result = await response!.json(); }
  catch { result = { error: "Invalid JSON response from provider" }; }

  if (!result?.error) {
    const inTok = Number(result?.usage?.prompt_tokens ?? 0);
    const outTok = Number(result?.usage?.completion_tokens ?? 0);
    const prevIn = Number(await providerSettings.used_input_tokens ?? 0);
    const prevOut = Number(await providerSettings.used_output_tokens ?? 0);
    providerSettings.used_input_tokens(prevIn + inTok);
    providerSettings.used_output_tokens(prevOut + outTok);
  }

  return result;
}
