import type { Row } from "@qino/qino";

/** A line as it is passed in. `price` is in minor units, finer if need be (23.45 = 0.2345 CHF);
 *  line amounts and totals are whole minor units. `taxRate` is in percent. */
export type Line = {
  name: string;
  description?: string;
  quantity?: number;
  unit?: string;
  price: number;
  taxRate?: number;
  /** Where bookkeeping books it (fin.accounting keeps the column); none: its default account. */
  account?: string;
};

/** Rounded half away from zero, so a credit note (negative) rounds as its invoice does. */
export const round = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));

/**
 * Line amounts and totals. Tax is rounded once per rate, not per line, so lines of one rate never
 * drift apart from their total. With `taxIncluded`, prices include tax and it is taken out of them.
 * A credit note has negative quantities: its amounts and totals come out negative.
 */
export function totals(lines: Line[], taxIncluded: boolean) {
  const amounts = lines.map((line) => round((line.quantity ?? 1) * line.price));
  const byRate = new Map<number, number>();
  lines.forEach((line, i) => byRate.set(line.taxRate ?? 0, (byRate.get(line.taxRate ?? 0) ?? 0) + amounts[i]));
  const rates = [...byRate].sort(([a], [b]) => a - b).map(([rate, sum]) => {
    const tax = round(taxIncluded ? sum * rate / (100 + rate) : sum * rate / 100);
    return { rate, net: taxIncluded ? sum - tax : sum, tax };
  });
  const net = rates.reduce((sum, r) => sum + r.net, 0);
  const tax = rates.reduce((sum, r) => sum + r.tax, 0);
  return { amounts, rates, net, tax, total: net + tax };
}

/** A stored line as passed in. */
export const lineOf = (row: Row): Line => ({
  name: String(row.name ?? ""),
  description: row.description ? String(row.description) : undefined,
  quantity: Number(row.quantity),
  unit: row.unit == null ? undefined : String(row.unit),
  price: Number(row.price),
  taxRate: Number(row.tax_rate),
  account: row.account ? String(row.account) : undefined,
});
