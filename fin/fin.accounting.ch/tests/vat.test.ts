import { assertEquals } from "@std/assert";
import { cancel, create, issue } from "@qino/qino/fin.invoice";

import { withFinApp } from "../../tests/app.ts";
import { vatReturn } from "../mod.ts";

const MODULES = ["fin.payment", "fin.invoice", "fin.accounting", "fin.accounting.ch"];
const period = { from: "2026-10-01", to: "2026-12-31" };

Deno.test("the VAT return adds up the books per rate and category, effective or at the net tax rate", async () => {
  await withFinApp(MODULES, async (app) => {
    type Lines = { name: string; price: number; taxRate: number; taxCategory?: string; account?: string }[];
    const issued = (date: string, lines: Lines, values = {}) =>
      create(app, { currency: "CHF", date, lines, ...values }).then((id) => issue(app, id));
    await issued("2026-10-05", [{ name: "Design", price: 100000, taxRate: 8.1 }, { name: "Book", price: 4000, taxRate: 2.6 }]);
    await issued("2026-10-06", [
      { name: "Export", price: 50000, taxRate: 0, taxCategory: "G" },
      { name: "Course", price: 30000, taxRate: 0, taxCategory: "E" },
      { name: "Default interest", price: 500, taxRate: 0 }, // not subject to tax: no turnover
    ]);
    await issued("2026-09-30", [{ name: "Before", price: 99900, taxRate: 8.1 }]); // another period
    const gone = await issued("2026-10-07", [{ name: "Wrong", price: 20000, taxRate: 8.1 }]);
    await cancel(app, Number(gone?.id)); // never sent, taken back: counts nothing
    await issued("2026-10-08", [{ name: "Rent", price: 200000, taxRate: 8.1 }], { direction: "in", number: "R-1" });
    await issued("2026-10-09", [{ name: "Printer", price: 100000, taxRate: 8.1, account: "1500" }], { direction: "in", number: "R-2" });

    const r = await vatReturn(app, period);
    assertEquals(r.turnover, 184000);
    assertEquals(r.deductions, [{ figure: "220", turnover: 50000 }, { figure: "230", turnover: 30000 }]);
    assertEquals(r.rates.map((x) => [x.figure, x.turnover, x.tax]), [["303", 100000, 8100], ["313", 4000, 104]]);
    assertEquals([r.input, r.investments, r.payable], [16200, 8100, 8100 + 104 - 16200 - 8100]);

    await app.settings["fin.accounting.ch"].vat.method("saldo");
    await app.settings["fin.accounting.ch"].vat.rate(6.2);
    const s = await vatReturn(app, period);
    assertEquals([s.saldo?.gross, s.saldo?.tax, s.payable], [112204, 6957, 6957]);
  });
});
