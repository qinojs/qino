import type { App } from "../../core/server.ts";
import { providers } from "./providers.ts";

export async function embeddings(
  data: { input: string | string[]; model?: string; _provider?: string },
  app: Pick<App, "settings">,
): Promise<unknown> {
  const defaultEmbeddingProvider = String(
    await app.settings.ai.default.embedding_provider ?? "jina.ai",
  );
  const defaultEmbeddingModel = String(
    await app.settings.ai.default.embedding_model ?? "",
  );
  const providerName = String(data._provider ?? defaultEmbeddingProvider);

  const provider = providers[providerName];
  if (!provider) return { error: `Unknown provider: ${providerName}` };

  const resolvedModel = data.model || defaultEmbeddingModel || provider.embeddingModel;
  if (!resolvedModel) {
    return { error: `Provider "${providerName}" has no embeddingModel configured.` };
  }

  const providerSettings = app.settings.ai.provider[providerName];
  const key = String(await providerSettings.key ?? "");
  if (!key) {
    return {
      error: `No API key configured for provider "${providerName}". Please add it in the CMS settings.`,
    };
  }

  const postData = {
    model: resolvedModel,
    input: data.input,
  };

  let response: Response;
  try {
    response = await fetch(provider.endpoint + "/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + key,
      },
      body: JSON.stringify(postData),
      signal: AbortSignal.timeout(provider.timeoutMs ?? 30000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { error: `Provider "${providerName}" timed out.` };
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }

  let result: Record<string, unknown>;
  try {
    result = await response.json();
  } catch {
    return { error: "Invalid JSON response from provider" };
  }

  if (!result?.error) {
    const usage = result?.usage as Record<string, unknown> | undefined;
    const tokens = Number(usage?.prompt_tokens ?? usage?.total_tokens ?? 0);
    const prev = Number(await providerSettings.used_input_tokens ?? 0);
    providerSettings.used_input_tokens(prev + tokens);
  }

  return result;
}
