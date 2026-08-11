import { sql, type App, type Db } from "../core/mod.ts";
import type { Jobs } from "../cron/mod.ts";
import { forget, prune } from "./mod.ts";

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
          score: { type: "number" }, // indexed together with scope_id, see ensureIndex below
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

// TEMP: hand-rolled until item.js can express composite secondary indexes — then this belongs in
// dbSchema and install() goes away. Every read filters scope_id first, so this index carries them
// all. The name stays out of "idx_score_*", the namespace the sqlite migration owns and drops.
const INDEX = "score_scope_score";

async function ensureIndex(db: Db): Promise<void> {
  if (db.dialect !== "mysql") { // sqlite and postgres are idempotent on their own
    await db.exec`CREATE INDEX IF NOT EXISTS ${sql.id(INDEX)} ON score (scope_id, score)`;
    return;
  }
  const has = await db.one`
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'score' AND index_name = ${INDEX}`;
  if (!has) await db.exec`CREATE INDEX ${sql.id(INDEX)} ON score (scope_id, score)`;
}

export function install({ app }: { app: App }): Promise<void> {
  return ensureIndex(app.db);
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // A deleted entry keeps no score; forget() ignores tables that are not scored.
  app.db.on("table:delete-after", ({ table, id }) => forget(app.db, String(table), Number(id)), { signal });
}
