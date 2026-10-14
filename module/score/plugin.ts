import { sql } from "@qino/qino";

import { prune, scores } from "./mod.ts";

import type { App, Db } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

type Props = Record<string, Record<string, unknown>>;

/** Every `score_<name>` table, declared with its key columns only, complete: they become the primary
 *  key (a row goes along with the entry of a key column that has `x-qg-parent`), score and time are
 *  added. */
export function dbSchema(merged: { properties: Record<string, { additionalProperties?: { properties?: Props } }> }) {
  const tables = Object.entries(merged.properties).filter(([table]) => table.startsWith("score_"));
  return { properties: Object.fromEntries(tables.map(([table, schema]) => {
    const props = schema.additionalProperties?.properties ?? {}, keys = Object.keys(props);
    const key = (col: string) => ({ ...props[col], "x-index": "primary", ...props[col]["x-qg-parent"] ? { "x-qg-on-parent-delete": "cascade" } : {} });
    return [table, { ...schema, additionalProperties: {
      properties: {
        ...Object.fromEntries(keys.map((col) => [col, key(col)])),
        score: { type: "number", "x-index": true },
        time: { type: "integer", default: 0 },
      },
      required: [...keys, "score", "time"],
    } }];
  })) };
}

export const cron = {
  prune: { every: "day", at: { hour: 4 }, jitter: 60 * 60, run: (app: App) => prune(app.db) },
} satisfies Jobs;

/** One-off: scores were in `score`, by table name in `score_scope`. Each goes to the score table whose
 *  only key column has that table as parent; without one it is dropped. Removable once every
 *  installation has booted once (> 1.0). */
async function unscope(db: Db) {
  if (!(await db.columns("score_scope").catch(() => [])).length) return;
  for (const { id, tbl } of await db.query`SELECT id, tbl FROM score_scope`) {
    for (const { table, keys: [key, more] } of scores(db)) {
      if (more || db.schema.properties[table].additionalProperties.properties[key]["x-qg-parent"] !== tbl) continue;
      await db.exec`INSERT INTO ${sql.id(table)} (${sql.id(key)}, score, time) SELECT id, score, time FROM score WHERE scope_id = ${id}`;
    }
  }
  await db.exec`DROP TABLE score`;
  await db.exec`DROP TABLE score_scope`;
  await db.loadTables();
}

export function init(app: App): Promise<void> {
  return unscope(app.db);
}
