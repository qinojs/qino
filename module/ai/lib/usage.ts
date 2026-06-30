import type { App } from "../../core/mod.ts";
import type { ProviderModelRow } from "../types.ts";

// Per-model token accounting. Prices are model-specific, so usage lives on ai_provider_model.
export async function addUsage(app: Pick<App, "db">, model: ProviderModelRow, usage: unknown): Promise<void> {
  const u = usage as Record<string, unknown> | undefined;
  const inTok = Number(u?.prompt_tokens ?? 0);
  const outTok = Number(u?.completion_tokens ?? u?.total_tokens ?? 0);
  if (!inTok && !outTok) return;
  await app.db.query`UPDATE ai_provider_model SET used_input_tokens = used_input_tokens + ${inTok}, used_output_tokens = used_output_tokens + ${outTok} WHERE id = ${model.id}`;
}
