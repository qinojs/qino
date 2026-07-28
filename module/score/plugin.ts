import type { App } from "../core/mod.ts";
import type { Jobs } from "../cron/mod.ts";
import { forget, prune } from "./mod.ts";

export const name = "score";
export const needs = ["core", "cron"];

export const dbSchema = {
  properties: {
    // One row per scored table — the name is stored here, never in `score`.
    score_scope: {
      additionalProperties: {
        properties: {
          id: { type: "integer", minimum: 0, maximum: 65535, "x-index": "primary", "x-autoincrement": true },
          tbl: { type: "string", maxLength: 64, "x-index": true },
        },
        required: ["id", "tbl"],
      },
    },
    score: {
      additionalProperties: {
        properties: {
          scope_id: { type: "integer", minimum: 0, maximum: 65535, "x-index": "primary" },
          id: { type: "integer", minimum: 0, "x-index": "primary" },
          score: { type: "number", "x-index": true },
          time: { type: "integer", default: 0 },
        },
        required: ["scope_id", "id", "score", "time"],
      },
    },
  },
};

export const cron = {
  prune: { every: "day", at: { hour: 4 }, jitter: 60 * 60, run: (app: App) => prune(app.db) },
} satisfies Jobs;

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // A deleted entry keeps no score; forget() ignores tables that are not scored.
  app.db.on("table:delete-after", ({ table, id }) => forget(app.db, String(table), Number(id)), { signal });
}
