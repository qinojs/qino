import type { ProviderModel, ProviderStrength } from "../types.ts";
import type { App } from "../../core/mod.ts";
import { providers } from "./providers.ts";

function normalizeModel(value: unknown): ProviderModel | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const id = String(data.id ?? "").trim();
  if (!id) return null;
  const strengths = Array.isArray(data.strengths)
    ? data.strengths.map((strength) => String(strength).trim()).filter(Boolean)
    : [];
  return {
    id,
    ...(data.label ? { label: String(data.label) } : {}),
    ...(data.description ? { description: String(data.description) } : {}),
    ...(data.source ? { source: String(data.source) } : {}),
    ...(data.syncedAt ? { syncedAt: String(data.syncedAt) } : {}),
    ...(strengths.length ? { strengths: strengths as ProviderStrength[] } : {}),
    ...(Number(data.maxInputTokens) > 0
      ? { maxInputTokens: Number(data.maxInputTokens) }
      : {}),
    ...(Number(data.maxOutputTokens) > 0
      ? { maxOutputTokens: Number(data.maxOutputTokens) }
      : {}),
    ...(Number(data.costPerMToken) >= 0
      ? { costPerMToken: Number(data.costPerMToken) }
      : {}),
    ...(Number(data.inputCostPerMToken) >= 0
      ? { inputCostPerMToken: Number(data.inputCostPerMToken) }
      : {}),
    ...(Number(data.outputCostPerMToken) >= 0
      ? { outputCostPerMToken: Number(data.outputCostPerMToken) }
      : {}),
    ...(data.supports && typeof data.supports === "object"
      ? { supports: data.supports as ProviderModel["supports"] }
      : {}),
  };
}

export function parseProviderModels(value: unknown): ProviderModel[] {
  if (!value) return [];
  let list: unknown;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  } else {
    list = value;
  }
  if (!Array.isArray(list)) return [];
  return list.map(normalizeModel).filter((model) => model !== null);
}

export async function customProviderModels(
  app: Pick<App, "settings">,
  providerName: string,
): Promise<ProviderModel[]> {
  return parseProviderModels(
    await app.settings.ai.provider[providerName]?.models,
  );
}

export async function providerModels(
  app: Pick<App, "settings">,
  providerName: string,
): Promise<ProviderModel[]> {
  const provider = providers[providerName];
  if (!provider) return [];
  const models = new Map<string, ProviderModel>();
  for (const model of provider.models ?? []) models.set(model.id, model);
  for (const model of await customProviderModels(app, providerName)) {
    models.set(model.id, model);
  }
  return [...models.values()];
}
