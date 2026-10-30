import type { App } from "@qino/qino";

/** The figure of the form a rate's turnover and tax go on: the current rates, and those before 2024. */
const FIGURES: Record<string, string> = {
  "8.1": "303",
  "2.6": "313",
  "3.8": "343",
  "7.7": "302",
  "2.5": "312",
  "3.7": "342",
};

/** Where turnover without Swiss tax goes, by tax category: exports (and what EN 16931 calls zero
 *  rated or intra-community) 220, services abroad — reverse charge at the customer — 221, excluded
 *  services 230. Not subject to tax (`O`: default interest, damages) is no turnover at all. */
const DEDUCTIONS: Record<string, string> = { G: "220", K: "220", Z: "220", AE: "221", E: "230" };

/** A tax code, `S8.1`, as category and rate. */
const parse = (code: unknown) => {
  const [, category, rate] = /^([A-Z]*)([\d.]*)$/.exec(String(code)) ?? [];
  return { category: category || "S", rate: Number(rate || 0) };
};

/**
 * The Swiss VAT return of a period, from the books: every entry line carries its tax code, category
 * and rate (fin.accounting books invoices so). Turnover (200) is all but what is not subject to tax;
 * taxed turnover goes per rate, the rest is deducted (220, 221, 230). Effective method: the tax per
 * rate less the input tax — on material and services (400), or on investments (405) where the entry
 * books onto an asset account. Net tax rate method (`fin.accounting.ch.vat.method` "saldo"): the
 * taxed turnover with tax times the net tax rate (`vat.rate`), no input tax. Amounts in minor units.
 */
export async function vatReturn(app: App, { from, to }: { from: string; to: string }) {
  const s = app.settings["fin.accounting"].accounts;
  const [due, input] = (await Promise.all([s.vatDue, s.vatInput])).map((v) => String(v ?? ""));
  const v = app.settings["fin.accounting.ch"].vat;
  const [method, saldo] = [String(await v.method ?? "effective"), Number(await v.rate ?? 0)];
  const rows = (await app.db.query`
    SELECT a.type, a.number, l.tax_code, SUM(l.amount) AS amount FROM accounting_entry_line l
    JOIN accounting_entry e ON e.id = l.entry_id JOIN accounting_account a ON a.id = l.account_id
    WHERE e.date >= ${from} AND e.date <= ${to} AND l.tax_code IS NOT NULL
    GROUP BY a.type, a.number, l.tax_code`)
    .map((row) => ({ type: row.type, number: row.number, amount: Number(row.amount), ...parse(row.tax_code) }));
  type Sum = (typeof rows)[number];
  const sum = (match: (row: Sum) => boolean) => rows.filter(match).reduce((total, row) => total + row.amount, 0);
  // turnover is credit on income, tax due credit on its account: both negative in the books
  const taxed = [...new Set(rows.filter((r) => r.type === "income" && r.category === "S").map((r) => r.rate))]
    .sort((a, b) => b - a);
  const rates = taxed.map((rate) => ({
    rate,
    figure: FIGURES[String(rate)] ?? "",
    turnover: -sum((r) => r.type === "income" && r.category === "S" && r.rate === rate),
    tax: -sum((r) => r.number === due && r.category === "S" && r.rate === rate),
  }));
  const deductions = [...new Set(Object.values(DEDUCTIONS))]
    .map((figure) => ({ figure, turnover: -sum((r) => r.type === "income" && DEDUCTIONS[r.category] === figure) }))
    .filter((d) => d.turnover);
  const turnover = [...rates, ...deductions].reduce((total, r) => total + r.turnover, 0);
  if (method === "saldo") {
    const gross = rates.reduce((total, r) => total + r.turnover + r.tax, 0);
    const tax = Math.round(gross * saldo / 100);
    const net = { rate: saldo, gross, tax };
    return { method, turnover, deductions, rates, saldo: net, input: 0, investments: 0, payable: tax };
  }
  const tax = rates.reduce((total, r) => total + r.tax, 0);
  // input tax on an entry that books onto an asset account is on an investment
  const inputs = await app.db.query`
    SELECT l.amount, (SELECT COUNT(*) FROM accounting_entry_line x
      JOIN accounting_account xa ON xa.id = x.account_id
      WHERE x.entry_id = l.entry_id AND x.tax_code IS NOT NULL AND xa.type = 'asset' AND xa.number <> ${input}
    ) AS assets
    FROM accounting_entry_line l JOIN accounting_entry e ON e.id = l.entry_id
    JOIN accounting_account a ON a.id = l.account_id
    WHERE e.date >= ${from} AND e.date <= ${to} AND a.number = ${input}`;
  const of = (investment: boolean) => inputs.filter((row) => !!Number(row.assets) === investment)
    .reduce((total, row) => total + Number(row.amount), 0);
  const [material, investments] = [of(false), of(true)];
  return { method, turnover, deductions, rates, input: material, investments, payable: tax - material - investments };
}
