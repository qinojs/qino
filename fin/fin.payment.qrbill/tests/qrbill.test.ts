import { assertEquals, assertStringIncludes } from "@std/assert";
import { ingest } from "@qino/qino/fin.bank.camt";
import { create as invoice, document, issue, refOf } from "@qino/qino/fin.invoice";
import { create, methods, slip } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { isQrIban, qrr, scor } from "../lib/reference.ts";

import type { App } from "@qino/qino";

Deno.test("references carry their check digits", () => {
  // QR reference: 26 digits and a recursive mod-10 check
  assertEquals(qrr("21000000000313947143000901"), "210000000003139471430009017"); // the SIX example
  assertEquals(qrr(1), "000000000000000000000000011");
  assertEquals(qrr(12345), "000000000000000000000123457");
  assertEquals(scor(539007547034), "RF18539007547034"); // the ISO 11649 example
  assertEquals([isQrIban("CH44 3199 9123 0008 8901 2"), isQrIban("CH93 0076 2011 6238 5295 7")], [true, false]);
});

/** A real app with payments, bank, invoices and the QR bill, paid into `iban`. */
const withApp = (iban: string, fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.bank", "fin.bank.camt", "fin.payment.qrbill", "fin.invoice"], async (app) => {
    await app.settings["fin.payment.qrbill"].iban(iban);
    await fn(app);
  });

/** A camt.054 credit of `amount` (in CHF) with `reference`. */
const credit = (id: string, amount: string, reference: string) => `<Document><BkToCstmrDbtCdtNtfctn><Ntfctn>
  <Id>${id}</Id><Acct><Id><IBAN>CH4431999123000889012</IBAN></Id><Ccy>CHF</Ccy></Acct>
  <Ntry><Amt Ccy="CHF">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-07</Dt></BookgDt>
    <AcctSvcrRef>${id}</AcctSvcrRef>
    <NtryDtls><TxDtls><RmtInf><Strd><CdtrRefInf><Ref>${reference}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls>
  </Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

Deno.test("an invoice paid by QR bill: slip, a partial transfer, the rest", async () => {
  await withApp("CH44 3199 9123 0008 8901 2", async (app) => {
    assertEquals(await methods(app, { amount: 100, currency: "CHF" }), [{ method: "qrbill", label: "QR-bill" }]);
    assertEquals(await methods(app, { amount: 100, currency: "USD" }), []);
    const draft = await invoice(app, { currency: "CHF", lang: "de", lines: [{ name: "Design", price: 50000 }] });
    const id = Number((await issue(app, draft))?.id);
    const order = { method: "qrbill", amount: 50000, currency: "CHF", ref: refOf(id), title: "Rechnung 2026-1" };
    const { id: payment, redirect } = await create(app, { ...order, return: "/" });
    assertStringIncludes(redirect, "/payment/pay/");
    const reference = String(await app.db.one`SELECT external_id FROM payment WHERE id = ${payment}`);
    assertEquals(reference, qrr(payment));
    assertStringIncludes((await slip(app, payment))!, "<svg");
    assertStringIncludes(await document(app, id), "Zahlteil"); // appended, in the invoice's language

    assertEquals(await ingest(app, credit("A", "200.00", reference)), { added: 1, matched: 1 });
    const state = async () => [
      ...Object.values(await app.db.row`SELECT status, paid FROM payment WHERE id = ${payment}` ?? {}),
      ...Object.values(await app.db.row`SELECT status, paid FROM invoice WHERE id = ${id}` ?? {}),
    ];
    assertEquals(await state(), ["processing", 20000, "open", 20000]);
    assertStringIncludes((await slip(app, payment))!, "<svg"); // the slip asks for the rest

    await ingest(app, credit("B", "300.00", reference));
    assertEquals(await state(), ["paid", 50000, "paid", 50000]);
    assertEquals(await slip(app, payment), undefined);
  });
});

Deno.test("with a normal IBAN the reference is a creditor reference", async () => {
  await withApp("CH93 0076 2011 6238 5295 7", async (app) => {
    const { id } = await create(app, { method: "qrbill", amount: 1000, currency: "EUR", return: "/" });
    assertEquals(await app.db.one`SELECT external_id FROM payment WHERE id = ${id}`, scor(id));
    assertStringIncludes((await slip(app, id))!, "<svg");
  });
});
