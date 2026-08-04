// Which countries the shop sells to, and what VAT they carry. The list itself belongs to
// locale.country — a shop only marks the rows it wants and hangs its own rate on them.

import type { Db } from "../../../module/core/mod.ts";
import { settingsOf } from "./shop.ts";

/** The countries the shop delivers to — every one of them while it has marked none. */
export async function shopCountries(db: Db): Promise<string[]> {
  const enabled = await db.col<string>`SELECT id FROM country WHERE shp3_enabled = ${true} ORDER BY id`;
  return enabled.length ? enabled : await db.col<string>`SELECT id FROM country ORDER BY id`;
}

/** Whether the shop delivers there — an address the customer typed has to pass this. */
export async function sellsTo(db: Db, id: string): Promise<boolean> {
  return (await shopCountries(db)).includes(id);
}

/** Where the shop stands. Prices are calculated for it until the customer names a country.
 *  Only a marked country stands in for the setting — the full list is alphabetical, not a location. */
export async function shopCountry(db: Db): Promise<string> {
  return String(await settingsOf(db).location.country ?? "") ||
    await db.one<string>`SELECT id FROM country WHERE shp3_enabled = ${true} ORDER BY id LIMIT 1` || "";
}

/** The VAT rate of a country, the shop's own location when none is given. */
export async function vatRate(db: Db, id: string): Promise<number> {
  const country = id || await shopCountry(db);
  if (!country) return 0;
  return Number(await db.one`SELECT shp3_default_vat_rate FROM country WHERE id = ${country}` ?? 0);
}
