import * as sqliteVec from "sqlite-vec";

import { create } from "./lib/collection.ts";
import * as file from "./sources/file.ts";
import schema from "./dbschema.json" with { type: "json" };
import fileSchema from "./sources/file.json" with { type: "json" };

import type { App } from "@qino/qino";

export { cron } from "./sources/file.ts";
export { healthChecks } from "./healthChecks.ts";

type Props = Record<string, Record<string, unknown>>;

/** Every `embedding_<name>` table, declared with its key columns only, complete: they become the
 *  primary key (vectors go along with the entry of a key column that has `x-qg-parent`), the chunk,
 *  collection and vector columns are added. */
export function dbSchema(merged: { properties: Record<string, { additionalProperties?: { properties?: Props } }> }) {
  const own = { ...schema.properties, ...fileSchema.properties };
  const tables = Object.entries({ ...merged.properties, ...own } as typeof merged.properties).filter(([table]) => table.startsWith("embedding_"));
  return { properties: { ...own, ...Object.fromEntries(tables.map(([table, schema]) => {
    const props = schema.additionalProperties?.properties ?? {}, keys = Object.keys(props);
    const key = (col: string) => ({ ...props[col], "x-index": "primary", ...props[col]["x-qg-parent"] ? { "x-qg-on-parent-delete": "cascade" } : {} });
    return [table, { ...schema, additionalProperties: {
      properties: {
        ...Object.fromEntries(keys.map((col) => [col, key(col)])),
        chunk: { type: "integer", "x-index": "primary", default: 0 },
        collection_id: { type: "integer", "x-index": "primary", "x-qg-parent": "ai_embed_collection", "x-qg-on-parent-delete": "cascade" },
        hash: { type: "string", maxLength: 64, "x-index": true },
        content: { type: "string" },
        embedding: { type: "array", items: { type: "number" }, "x-vector": true, "x-index": true },
      },
      required: [...keys, "chunk", "collection_id", "hash", "embedding"],
    } }];
  })) } };
}

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
