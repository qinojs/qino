import { sql, type App } from "../core/mod.ts";
import { currency } from "./mod.ts";

export const name = "locale.currency";
export const description = "The world's currencies. Names and symbols come from Intl, stored is only the exchange rate.";
export const needs = ["core"];

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

/** A row per currency, so a rate has something to hang on. Rates stay empty until someone fills them. */
export async function install({ app }: { app: App }): Promise<void> {
  const known = new Set(await app.db.col<string>`SELECT id FROM currency`);
  const rows = currency.codes().filter((id) => !known.has(id)).map((id) => sql`(${id})`);
  if (rows.length) await app.db.exec`INSERT INTO currency (id) VALUES ${sql.join(rows)}`;
}
