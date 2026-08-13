import { sql } from "@qino/qino";

import { DATA } from "./lib/data.ts";

import type { App } from "@qino/qino";

// Column names and lengths are the ones the PHP original used, so a migrated database fits.
export const dbSchema = {
  properties: {
    country: {
      additionalProperties: {
        properties: {
          id: { type: "string", maxLength: 2, "x-index": "primary" },
          iso3: { type: "string", maxLength: 3 },
          currency: { type: "string", maxLength: 3, "x-index": true },
          calling: { type: "string", maxLength: 8 },
          internet_domain: { type: "string", maxLength: 5, "x-index": true },
        },
        required: ["id"],
      },
    },
  },
};

/** Seeds what is missing, in one statement. An existing row keeps its values — a site may have
 *  edited them. Pure reference data, so it goes past the table layer and its events. */
export async function install({ app }: { app: App }): Promise<void> {
  const known = new Set(await app.db.col<string>`SELECT id FROM country`);
  const rows = DATA.split("\n")
    .map((line) => line.split(","))
    .filter(([id]) => !known.has(id))
    .map(([id, iso3, currency, calling, domain]) => sql`(${id}, ${iso3}, ${currency}, ${calling}, ${domain})`);
  if (rows.length) await app.db.exec`INSERT INTO country (id, iso3, currency, calling, internet_domain) VALUES ${sql.join(rows)}`;
}
