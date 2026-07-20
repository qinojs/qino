import type { App } from "../../core/mod.ts";
import type { ProviderModelRow } from "../types.ts";

// Per-model token accounting. Prices are model-specific, so usage lives on ai_provider_model.
export async function addUsage(app: Pick<App, "db">, model: ProviderModelRow, usage: unknown): Promise<void> {
  const u = usage as Record<string, unknown> | undefined;
  const inTok = Number(u?.prompt_tokens ?? 0);
  // providers that only send total_tokens: derive output as total - prompt, not the whole total
  const outTok = u?.completion_tokens != null ? Number(u.completion_tokens) : Math.max(0, Number(u?.total_tokens ?? 0) - inTok);
  if (!inTok && !outTok) return;
  await app.db.exec`UPDATE ai_provider_model SET used_input_tokens = used_input_tokens + ${inTok}, used_output_tokens = used_output_tokens + ${outTok} WHERE id = ${model.id}`;
}
