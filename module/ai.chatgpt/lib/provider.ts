import type { App } from "@qino/qino";

const PROVIDER = { name: "chatgpt-plan", type: "chatgpt-plan", endpoint: "https://api.openai.com/v1" };

export async function ensureProvider(app: App): Promise<void> {
  const existing = await app.db.row`SELECT type, endpoint FROM ai_provider WHERE name = ${PROVIDER.name}`;
  if (!existing) { await app.db.table("ai_provider").insert({ ...PROVIDER }); return; }
  if (existing.type !== PROVIDER.type || existing.endpoint !== PROVIDER.endpoint)
    throw new Error(`Provider "${PROVIDER.name}" already exists with another type or endpoint`);
}

/** Add the selected account's visible text and function-tool models without changing existing offers. */
export async function syncModels(app: App, names: string[]): Promise<void> {
  if (!names.length) return;
  const db = app.db;
  await db.transaction(async () => {
    const provider = await db.one`SELECT id FROM ai_provider WHERE name = ${PROVIDER.name} AND type = ${PROVIDER.type} AND endpoint = ${PROVIDER.endpoint}`;
    if (!provider) throw new Error("ChatGPT plan provider is unavailable");
    const models = new Map((await db.query`SELECT id, name FROM ai_model`).map((row) => [String(row.name), Number(row.id)]));
    const offers = new Set((await db.query`SELECT mp.provider_model, m.name FROM ai_model_provider mp
      JOIN ai_model m ON m.id = mp.model_id WHERE mp.provider_id = ${provider}`)
      .map((row) => String(row.provider_model || row.name)));
    for (const name of new Set(names)) {
      if (!name || name.length > 191) continue;
      let model = models.get(name);
      if (!model) { model = Number(await db.table("ai_model").insert({ name })); models.set(name, model); }
      if (!offers.has(name)) {
        await db.table("ai_model_provider").insert({ model_id: model, provider_id: provider });
        offers.add(name);
      }
      for (const capability of ["text", "tools"]) {
        if (!await db.one`SELECT 1 FROM ai_model_capability WHERE model_id = ${model} AND capability = ${capability}`)
          await db.table("ai_model_capability").insert({ model_id: model, capability });
      }
    }
  });
}
