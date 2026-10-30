// ISO 4217 currencies. Names, symbols and decimals come from Intl; the table only stores the rate.
import { ratesOn } from "./lib/rates.ts";

import type { Db } from "@qino/qino";

export { updateRates } from "./lib/rates.ts";

/** Values of the `update` setting: how often the rates are fetched. */
export const EVERY = ["never", "daily", "hourly"];

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

  /** How many decimals its minor unit has: CHF 2, JPY 0, KWD 3 — `amount / 10 ** decimals` turns
   *  minor units into what people read. */
  decimals(id: string): number {
    const format = new Intl.NumberFormat("en", { style: "currency", currency: id });
    return format.resolvedOptions().maximumFractionDigits ?? 2;
  },

  /** The amount as the language writes it, with the currency's own number of decimals. */
  format(value: number, id: string, lang: string): string {
    return new Intl.NumberFormat(lang, { style: "currency", currency: id }).format(value);
  },

  /** How many of `to` one `from` buys: by the stored rates, or with `date` (`YYYY-MM-DD`) by that day's,
   *  asked of a source that knows past days — throws if none answers. */
  async rate(db: Db, from: string, to: string, { date }: { date?: string } = {}): Promise<number | undefined> {
    if (from === to) return 1;
    const of = date ? await ratesOn(date).then((rates) => (id: string) => rates.get(id)) : (id: string) => usd(db, id);
    const [a, b] = await Promise.all([of(from), of(to)]);
    if (a && b) return b / a;
  },

  all: (db: Db): Promise<Record<string, unknown>[]> => db.query`SELECT * FROM currency ORDER BY id`,
};

const usd = (db: Db, id: string) => db.one<number>`SELECT rate_to_usd FROM currency WHERE id = ${id}`;
