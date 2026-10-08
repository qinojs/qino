import { assertEquals } from "@std/assert";
import { book } from "@qino/qino/fin.accounting";
import { strFromU8, unzipSync } from "fflate";

import { withFinApp } from "../../tests/app.ts";
import { exportBooks } from "../mod.ts";

import type { App } from "@qino/qino";

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.invoice", "fin.accounting", "fin.accounting.ch", "fin.accounting.export"], fn);

Deno.test("the books of a period export as a ZIP: journal, balances, receipts", async () => {
  await withApp(async (app) => {
    const receipt = await app.dbFiles.add(new File(["rent"], "Miete Oktober.pdf", { type: "application/pdf" }));
    const lines = [{ account: "6000", amount: 180000, taxCode: "8.1" }, { account: "1020", amount: -180000 }];
    await book(app, { date: "2026-10-01", text: 'Rent; "October"', lines, files: [receipt] });
    await book(app, { date: "2027-01-01", text: "Next year", lines });
    const files = unzipSync(await exportBooks(app, { from: "2026-01-01", to: "2026-12-31" }));
    assertEquals(Object.keys(files).sort(), ["balances.csv", "journal.csv", `receipts/1-Miete_Oktober.pdf`]);
    const journal = strFromU8(files["journal.csv"]).split("\r\n");
    assertEquals(journal.length, 4); // head, two lines, the end
    const rent = '2026-10-01;1;"Rent; ""October""";6000;Raumaufwand;1800.00;;8.1;CHF;;;receipts/1-Miete_Oktober.pdf';
    assertEquals(journal[1], rent);
    assertEquals(strFromU8(files["receipts/1-Miete_Oktober.pdf"]), "rent");
  });
});
