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

/**
 * The Swiss VAT return of a period, from the books: every entry line carries its rate as tax code
 * (fin.accounting books invoices so). Effective method: the tax on turnover per rate less the
 * input tax. Net tax rate method (`fin.accounting.ch.vat.method` "saldo"): the turnover with tax
 * times the net tax rate (`vat.rate`), no input tax. Amounts in minor units.
 */
export async function vatReturn(app: App, { from, to }: { from: string; to: string }) {
  const s = app.settings["fin.accounting"].accounts;
  const [due, input] = (await Promise.all([s.vatDue, s.vatInput])).map((v) => String(v ?? ""));
  const v = app.settings["fin.accounting.ch"].vat;
  const [method, saldo] = [String(await v.method ?? "effective"), Number(await v.rate ?? 0)];
  const rows = await app.db.query`
    SELECT a.type, a.number, l.tax_code, SUM(l.amount) AS amount FROM accounting_entry_line l
    JOIN accounting_entry e ON e.id = l.entry_id JOIN accounting_account a ON a.id = l.account_id
    WHERE e.date >= ${from} AND e.date <= ${to} AND l.tax_code IS NOT NULL
    GROUP BY a.type, a.number, l.tax_code`;
  const sum = (match: (row: Record<string, unknown>) => boolean) =>
    rows.filter(match).reduce((total, row) => total + Number(row.amount), 0);
  const codes = [...new Set(rows.filter((r) => r.type === "income").map((r) => String(r.tax_code)))]
    .sort((a, b) => Number(b) - Number(a));
  // turnover is credit on income, tax due credit on its account: both negative in the books
  const rates = codes.map((code) => ({
    rate: Number(code),
    figure: FIGURES[code] ?? "",
    turnover: -sum((r) => r.type === "income" && r.tax_code === code),
    tax: -sum((r) => r.number === due && r.tax_code === code),
  }));
  const turnover = rates.reduce((total, r) => total + r.turnover, 0);
  const exempt = rates.filter((r) => !r.rate).reduce((total, r) => total + r.turnover, 0);
  if (method === "saldo") {
    const gross = rates.reduce((total, r) => total + r.turnover + r.tax, 0);
    const tax = Math.round(gross * saldo / 100);
    return { method, turnover, exempt, rates, saldo: { rate: saldo, gross, tax }, input: 0, payable: tax };
  }
  const tax = rates.reduce((total, r) => total + r.tax, 0);
  const inputTax = sum((r) => r.number === input);
  return { method, turnover, exempt, rates, input: inputTax, payable: tax - inputTax };
}
