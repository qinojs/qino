import * as sqliteVec from "sqlite-vec";

import { create } from "./lib/collection.ts";
import * as file from "./sources/file.ts";
import schema from "./dbschema.json" with { type: "json" };
import fileSchema from "./sources/file.json" with { type: "json" };

import type { App } from "@qino/qino";

export { cron } from "./sources/file.ts";
export { healthChecks } from "./healthChecks.ts";

export const dbSchema = { properties: { ...schema.properties, ...fileSchema.properties } };

export const settingsSchema = {
  properties: {
    primary: { type: "integer", default: 0, description: "Collection id used when none is given; 0 uses the first." },
    chunkChars: { type: "integer", minimum: 100, default: 4000, description: "Maximum characters per indexed text chunk." },
    files: { type: "boolean", default: false, description: "Index every file on upload and catch up on the others each hour." },
  },
};

/** Seed the initial collection without replacing a chosen one. */
export async function install({ app }: { app: App }): Promise<void> {
  if (await app.db.one`SELECT id FROM ai_embed_collection LIMIT 1`) return;
  await create(app, "jina-embeddings-v5-omni-small", 1024);
}

/** SQLite gets its vector functions per connection; MariaDB and PostgreSQL have them built in. */
export function init(app: App, options: { signal: AbortSignal }): void {
  if (app.db.dialect === "sqlite") sqliteVec.load(app.db);
  file.init(app, options);
}
