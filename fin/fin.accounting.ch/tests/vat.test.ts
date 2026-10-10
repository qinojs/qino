import { assertEquals } from "@std/assert";
import { cancel, create, issue } from "@qino/qino/fin.invoice";

import { withFinApp } from "../../tests/app.ts";
import { vatReturn } from "../mod.ts";

const MODULES = ["fin.payment", "fin.invoice", "fin.accounting", "fin.accounting.ch"];
const period = { from: "2026-10-01", to: "2026-12-31" };

Deno.test("the VAT return adds up the books per rate, effective or at the net tax rate", async () => {
  await withFinApp(MODULES, async (app) => {
    type Lines = { name: string; price: number; taxRate: number }[];
    const issued = (date: string, lines: Lines, values = {}) =>
      create(app, { currency: "CHF", date, lines, ...values }).then((id) => issue(app, id));
    await issued("2026-10-05", [{ name: "Design", price: 100000, taxRate: 8.1 }, { name: "Book", price: 4000, taxRate: 2.6 }]);
    await issued("2026-10-06", [{ name: "Export", price: 50000, taxRate: 0 }]);
    await issued("2026-09-30", [{ name: "Before", price: 99900, taxRate: 8.1 }]); // another period
    const gone = await issued("2026-10-07", [{ name: "Wrong", price: 20000, taxRate: 8.1 }]);
    await cancel(app, Number(gone?.id)); // taken back: counts nothing
    await issued("2026-10-08", [{ name: "Rent", price: 200000, taxRate: 8.1 }], { direction: "in", number: "R-1" });

    const r = await vatReturn(app, period);
    assertEquals([r.turnover, r.exempt], [154000, 50000]);
    assertEquals(r.rates.map((x) => [x.figure, x.turnover, x.tax]), [
      ["303", 100000, 8100],
      ["313", 4000, 104],
      ["", 50000, 0],
    ]);
    assertEquals([r.input, r.payable], [16200, 8100 + 104 - 16200]);

    await app.settings["fin.accounting.ch"].vat.method("saldo");
    await app.settings["fin.accounting.ch"].vat.rate(6.2);
    const s = await vatReturn(app, period);
    assertEquals([s.saldo?.gross, s.saldo?.tax, s.payable], [162204, 10057, 10057]);
  });
});
