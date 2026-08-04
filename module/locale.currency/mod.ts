// ISO 4217 currencies. Names, symbols and decimals come from Intl — the row exists to carry
// the one thing no standard knows: the exchange rate.

import type { Db } from "../core/mod.ts";
export { updateRates } from "./lib/rates.ts";

export const currency = {
  /** Every currency Intl knows. */
  codes: (): string[] => Intl.supportedValuesOf("currency"),

  /** "Swiss Franc", "Schweizer Franken" — the code itself if the language has no name for it. */
  name(id: string, lang: string): string {
    return new Intl.DisplayNames([lang], { type: "currency" }).of(id) ?? id;
  },

  symbol(id: string, lang: string): string {
    const parts = new Intl.NumberFormat(lang, { style: "currency", currency: id }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? id;
  },

  /** The amount as the language writes it, with the currency's own number of decimals. */
  format(value: number, id: string, lang: string): string {
    return new Intl.NumberFormat(lang, { style: "currency", currency: id }).format(value);
  },

  /** How many of `to` one `from` buys, via the stored USD rates. */
  async rate(db: Db, from: string, to: string): Promise<number | undefined> {
    if (from === to) return 1;
    const [a, b] = [await usd(db, from), await usd(db, to)];
    if (a && b) return b / a;
  },

  all: (db: Db): Promise<Record<string, unknown>[]> => db.query`SELECT * FROM currency ORDER BY id`,
};

const usd = (db: Db, id: string) => db.one<number>`SELECT rate_to_usd FROM currency WHERE id = ${id}`;
