import type { App } from "@qino/qino";

export type Group = { id: number; name: string; model: string; dimensions: number; revision: number; enabled: boolean };
export type Selection = { model?: string; dimensions?: number };

const nameOf = (model: string, dimensions: number) => `${model}/${dimensions}`;

/** A model and vector dimension identify one searchable space. */
export async function create(app: App, model: string, dimensions: number): Promise<Group> {
  model = typeof model === "string" ? model.trim() : "";
  if (!model || model.length > 191 || !Number.isSafeInteger(dimensions) || dimensions < 1)
    throw new Error("A model and positive vector dimension are required");
  const name = nameOf(model, dimensions), db = app.db;
  const found = await db.row<Group>`SELECT * FROM ai1_embed_collection WHERE name = ${name}`;
  if (found) return found;
  await db.table("ai1_embed_collection").insert({ name, model, dimensions });
  return (await db.row<Group>`SELECT * FROM ai1_embed_collection WHERE name = ${name}`)!;
}

/** Without a selection, use the chosen primary space or the first one created. */
export async function group(app: App, { model, dimensions }: Selection = {}, make = false): Promise<Group | undefined> {
  if (model !== undefined || dimensions !== undefined) {
    if (model === undefined || dimensions === undefined) throw new Error("Select both model and dimensions");
    return make ? create(app, model, dimensions)
      : app.db.row<Group>`SELECT * FROM ai1_embed_collection WHERE name = ${nameOf(model.trim(), dimensions)}`;
  }
  const primary = String(await app.settings["ai1.embed"].primary || "");
  if (primary) {
    const found = await app.db.row<Group>`SELECT * FROM ai1_embed_collection WHERE name = ${primary}`;
    if (found) return found;
  }
  return app.db.row<Group>`SELECT * FROM ai1_embed_collection ORDER BY id LIMIT 1`;
}
