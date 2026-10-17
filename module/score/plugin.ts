import { prune } from "./mod.ts";

import type { App } from "@qino/qino";
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
