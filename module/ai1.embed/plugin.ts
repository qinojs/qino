import * as sqliteVec from "sqlite-vec";

import { collections, create, drop } from "./lib/collection.ts";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    primary: { type: "integer", default: 0, description: "Collection id used when none is given; 0 uses the first." },
    chunkChars: { type: "integer", minimum: 100, default: 4000, description: "Maximum characters per indexed text chunk." },
  },
};

/** Seed the initial collection without replacing a chosen one. */
export async function install({ app }: { app: App }): Promise<void> {
  if (await app.db.one`SELECT id FROM ai1_embed_collection LIMIT 1`) return;
  await create(app, "jina-embeddings-v5-omni-small", 1024);
}

/** The collection tables are created at runtime, so the schema does not know them. */
export async function uninstall({ app }: { app: App }): Promise<void> {
  for (const { id } of await collections(app)) await drop(app, id);
}

/** SQLite gets its vector functions per connection; MariaDB and PostgreSQL have them built in. */
export function init(app: App): void {
  if (app.db.dialect === "sqlite") sqliteVec.load(app.db);
}
