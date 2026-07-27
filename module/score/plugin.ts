import type { App } from "../core/mod.ts";
import type { Jobs } from "../cron/mod.ts";
import { forget, prune, scored } from "./mod.ts";

export const name = "score";
export const needs = ["core", "cron"];

export const dbSchema = {
  properties: {
    score: {
      additionalProperties: {
        properties: {
          tbl: { type: "string", maxLength: 32, "x-index": "primary" },
          id: { type: "integer", minimum: 0, "x-index": "primary" },
          score: { type: "number", "x-index": true },
          time: { type: "integer", default: 0 },
        },
        required: ["tbl", "id", "score", "time"],
      },
    },
  },
};

export const cron = {
  prune: { every: "day", at: { hour: 4 }, jitter: 60 * 60, run: (app: App) => prune(app.db) },
} satisfies Jobs;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // A deleted entry keeps no score.
  app.db.on("table:delete-after", async ({ table, id }) => {
    if (scored(app.db)[String(table)]) await forget(app.db, String(table), Number(id));
  }, { signal });
}
