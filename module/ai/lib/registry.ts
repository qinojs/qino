import type { App } from "@qino/qino";
import type { Kind, ProviderModelRow, ProviderRow } from "../types.ts";

// DB-backed provider/model registry. Loaded fresh per call — two small SELECTs,
// negligible next to the provider round-trip, and never stale.

type Registry = {
  providers: Map<string, ProviderRow>; // by name
  byId: Map<number, ProviderRow>;
  models: ProviderModelRow[];
};

async function getRegistry(app: Pick<App, "db">): Promise<Registry> {
  const providers = new Map<string, ProviderRow>();
  const byId = new Map<number, ProviderRow>();
  for (const p of await app.db.query<ProviderRow>`SELECT * FROM ai_provider`) {
    providers.set(p.name, p);
    byId.set(p.id, p);
  }
  const models = await app.db.query<ProviderModelRow>`SELECT * FROM ai_provider_model ORDER BY is_default DESC, id`;
  return { providers, byId, models };
}

/** Resolve a provider (+ model) for a kind, honouring explicit name/model and `is_default`. */
export async function resolve(
  app: Pick<App, "db">,
  opts: { provider?: string; model?: string; kind: Kind },
): Promise<{ provider: ProviderRow; model?: ProviderModelRow }> {
  const reg = await getRegistry(app);
  let provider: ProviderRow | undefined;
  if (opts.provider) {
    provider = reg.providers.get(opts.provider);
    if (!provider) throw new Error(`Unknown provider: ${opts.provider}`);
  }

  let models = reg.models.filter((m) => m.kind === opts.kind);
  if (provider) models = models.filter((m) => m.provider_id === provider!.id);

  // models are ordered is_default DESC, id — first is the natural default.
  const model = opts.model ? models.find((m) => m.model_id === opts.model) : models[0];

  provider ??= model ? reg.byId.get(model.provider_id) : reg.providers.values().next().value;
  if (!provider) throw new Error("No AI provider configured");
  return { provider, model };
}
