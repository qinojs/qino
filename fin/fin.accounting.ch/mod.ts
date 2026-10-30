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

/** Where turnover without Swiss tax goes, by category: exports 220, abroad (reverse charge) 221, excluded
 *  230; not subject to tax (`O`) is no turnover. */
const DEDUCTIONS: Record<string, string> = { G: "220", K: "220", Z: "220", AE: "221", E: "230" };

/** A tax code, `S8.1`, as category and rate. */
const parse = (code: unknown) => {
  const [, category, rate] = /^([A-Z]*)([\d.]*)$/.exec(String(code)) ?? [];
  return { category: category || "S", rate: Number(rate || 0) };
};

/** The Swiss VAT return of a period, from the tax codes in the books: effective (input tax 400, 405 on
 *  assets), or at the net tax rate (`vat.method` "saldo"). Amounts in minor units. */
export async function vatReturn(app: App, { from, to }: { from: string; to: string }) {
  const s = app.settings["fin.accounting"].accounts;
  const [due, input, losses] = (await Promise.all([s.vatDue, s.vatInput, s.losses])).map((v) => String(v ?? ""));
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
  // turnover is credit on income, tax due credit on its account: both negative in the books; a loss
  // written off is debit on its account, a reduction of consideration (235) off the turnover it was
  const sold = (r: Sum) => r.type === "income" || (!!losses && r.number === losses);
  const taxed = [...new Set(rows.filter((r) => sold(r) && r.category === "S").map((r) => r.rate))]
    .sort((a, b) => b - a);
  const rates = taxed.map((rate) => ({
    rate,
    figure: FIGURES[String(rate)] ?? "",
    turnover: -sum((r) => sold(r) && r.category === "S" && r.rate === rate),
    tax: -sum((r) => r.number === due && r.category === "S" && r.rate === rate),
  }));
  const lost = sum((r) => !!losses && r.number === losses && (r.category === "S" || r.category in DEDUCTIONS));
  const deductions = [
    ...[...new Set(Object.values(DEDUCTIONS))]
      .map((figure) => ({ figure, turnover: -sum((r) => sold(r) && DEDUCTIONS[r.category] === figure) })),
    { figure: "235", turnover: lost },
  ].filter((d) => d.turnover);
  const turnover = [...rates, ...deductions].reduce((total, r) => total + r.turnover, 0);
  if (method === "saldo") {
    const gross = rates.reduce((total, r) => total + r.turnover + r.tax, 0);
    const tax = Math.round(gross * saldo / 100);
    return {
      method, turnover, deductions, rates, saldo: { rate: saldo, gross, tax }, input: 0, investments: 0, payable: tax,
    };
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
