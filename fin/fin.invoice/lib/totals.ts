import type { Row } from "@qino/qino";

/** A line as it is passed in. `price` is in minor units, finer if need be (23.45 = 0.2345 CHF);
 *  line amounts and totals are whole minor units. `taxRate` is in percent. */
export type Line = { name: string; description?: string; qty?: number; unit?: string; price: number; taxRate?: number };

/**
 * Line amounts and totals. Tax is rounded once per rate, not per line, so lines of one rate never
 * drift apart from their total. With `gross`, prices include tax and it is taken out of them.
 */
export function totals(lines: Line[], gross: boolean) {
  const amounts = lines.map((line) => Math.round((line.qty ?? 1) * line.price));
  const byRate = new Map<number, number>();
  lines.forEach((line, i) => byRate.set(line.taxRate ?? 0, (byRate.get(line.taxRate ?? 0) ?? 0) + amounts[i]));
  const rates = [...byRate].sort(([a], [b]) => a - b).map(([rate, sum]) => {
    const tax = Math.round(gross ? sum * rate / (100 + rate) : sum * rate / 100);
    return { rate, net: gross ? sum - tax : sum, tax };
  });
  const net = rates.reduce((sum, r) => sum + r.net, 0);
  const tax = rates.reduce((sum, r) => sum + r.tax, 0);
  return { amounts, rates, net, tax, total: net + tax };
}

/** A stored line as passed in. */
export const lineOf = (row: Row): Line => ({
  name: String(row.name ?? ""),
  description: row.description ? String(row.description) : undefined,
  qty: Number(row.qty),
  unit: row.unit == null ? undefined : String(row.unit),
  price: Number(row.price),
  taxRate: Number(row.tax_rate),
});
