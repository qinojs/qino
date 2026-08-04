// The shop prices in its own currencies (shp3_currency), the world's rates live in locale.currency.
// Whenever fresh rates arrive, the shop's factors are taken from them — relative to its main
// currency, which stays the yardstick at 1.

import type { Db } from "../../../module/core/mod.ts";
import { mainCurrency, type Currency } from "./rows.ts";

export async function syncFactors(db: Db): Promise<void> {
  const main = await mainCurrency(db);
  if (!main) return;
  const rates = new Map<string, number>();
  for (const row of await db.query`SELECT id, rate_to_usd FROM currency WHERE rate_to_usd IS NOT NULL`) {
    rates.set(String(row.id), Number(row.rate_to_usd));
  }
  const base = rates.get(main.$id);
  if (!base) return; // the main currency has no rate — nothing to relate the others to
  for (const row of await db.table("shp3_currency").all<Currency>``) {
    const rate = rates.get(row.$id);
    if (rate) row.factor = row.$id === main.$id ? 1 : rate / base;
  }
}
