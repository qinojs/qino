import { sql, unixTime, type App } from "../core/mod.ts";
import type { Jobs } from "../cron/mod.ts";
import { currency } from "./mod.ts";
import { updateRates } from "./lib/rates.ts";

export const name = "locale.currency";
export const description = "The world's currencies. Names and symbols come from Intl, stored is only the exchange rate.";
export const needs = ["core", "cron"];

export const settingsSchema = {
  properties: {
    update: { type: "string", enum: ["never", "daily", "hourly"], default: "never", description: "How often the job fetches the exchange rates." },
    updated: { type: "integer", default: 0, description: "When the rates last arrived." },
    source: { type: "string", description: "Which source answered last." },
  },
};

export const dbSchema = {
  properties: {
    currency: {
      additionalProperties: {
        properties: {
          id: { type: "string", maxLength: 3, "x-index": "primary" },
          rate_to_usd: { type: "number" },
        },
        required: ["id"],
      },
    },
  },
};

// One job for every frequency: it wakes up hourly and asks how old the rates may get. The ECB
// publishes once a working day around 16:00 CET, so `hourly` is for sources that move faster.
export const cron = {
  rates: {
    every: "hour",
    at: { minute: 20 },
    jitter: 10 * 60,
    run: async (app: App) => {
      const set = app.settings["locale.currency"];
      const every = String(await set.update ?? "never");
      if (every === "never") return;
      if (every === "daily" && unixTime() - Number(await set.updated ?? 0) < 20 * 3600) return;
      await updateRates(app);
    },
  },
} satisfies Jobs;

/** A row per currency, so a rate has something to hang on. Rates stay empty until someone fills them. */
export async function install({ app }: { app: App }): Promise<void> {
  const known = new Set(await app.db.col<string>`SELECT id FROM currency`);
  const rows = currency.codes().filter((id) => !known.has(id)).map((id) => sql`(${id})`);
  if (rows.length) await app.db.exec`INSERT INTO currency (id) VALUES ${sql.join(rows)}`;
}
