import type { App } from "@qino/qino";

/** Each collection's model must be callable: offered by a provider that has a key. Checked without a
 *  call (that costs); calls that fail show among the AI calls. */
export function healthChecks(app: App) {
  const offers = async () => (await app.db.query`
    SELECT c.model, p.name AS provider FROM ai1_embed_collection c
    LEFT JOIN ai1_model m ON m.name = c.model LEFT JOIN ai1_model_provider mp ON mp.model_id = m.id
    LEFT JOIN ai1_provider p ON p.id = mp.provider_id ORDER BY c.id`).map((r) => ({ model: String(r.model), provider: r.provider && String(r.provider) }));
  const models = (rows: { model: string }[]) => [...new Set(rows.map((r) => r.model))];
  return {
    error: {
      "embedding model offered by no provider": async () => {
        const rows = await offers(), none = models(rows).filter((model) => !rows.some((r) => r.model === model && r.provider));
        if (none.length) return { info: `${none.join(", ")}: no vectors can be made or searched` };
      },
    },
    warning: {
      "embedding model without a key": async () => {
        const rows = (await offers()).filter((r) => r.provider);
        const keyed = new Set<string>();
        for (const r of rows) if (await app.settings.core.keys[r.provider!]) keyed.add(r.model);
        const none = models(rows).filter((model) => !keyed.has(model));
        if (none.length) return { info: `${none.join(", ")}: none of its providers has a key in core.keys` };
      },
    },
  };
}
