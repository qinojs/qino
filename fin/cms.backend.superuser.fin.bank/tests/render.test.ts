import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { create, issue } from "@qino/qino/fin.invoice";

import api from "../nodeApi.ts";
import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import { render } from "../render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const FIN = ["fin.payment", "fin.bank", "fin.bank.camt", "fin.invoice"];

type As = (url: string, run: () => Promise<unknown>) => Promise<unknown>;

const withApp = (fn: (app: App, as: As, node: Node) => Promise<void>) =>
  withFinApp(FIN, async (app) => {
    await fn(app, (url, run) => inRequest(app, url, run), backendNode(app, "/backend/bank"));
  });

const camt = `<Document><BkToCstmrStmt><Stmt><Id>S1</Id>
  <Acct><Id><IBAN>CH5604835012345678009</IBAN></Id><Ccy>CHF</Ccy></Acct>
  <Ntry><Amt Ccy="CHF">431.32</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-07</Dt></BookgDt><AcctSvcrRef>A</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Kunde &amp; Co</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Rechnung</Ustrd></RmtInf></TxDtls></NtryDtls>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`;

Deno.test("a statement is read, its unclaimed line suggests the invoice of its amount, and is assigned", async () => {
  await withApp(async (app, as, node) => {
    const base = "http://qino.test/backend/bank";
    const invoice = Number((await issue(app, await create(app, {
      currency: "CHF", party: { name: "Kunde & Co" }, lines: [{ title: "Design", price: 39900, taxRate: 8.1 }],
    })))?.id);
    const read = await as(base, () => api(node, { camt: [camt, camt] })) as { ok: boolean; message: string };
    assertEquals(read.ok, true);
    assertStringIncludes(read.message, "1 new lines"); // the second copy adds nothing

    let page = String(await as(`${base}?state=open`, () => render(node)));
    for (const part of ["CH5604835012345678009", "Kunde &amp; Co", "data-assign", `value="fin.invoice:${invoice}"`]) {
      assertStringIncludes(page, part);
    }
    const line = Number(await app.db.one`SELECT id FROM bank_tx`);
    await as(base, () => api(node, { assign: { id: String(line), ref: `fin.invoice:${invoice}` } }));
    assertEquals((await app.db.row`SELECT status FROM invoice WHERE id = ${invoice}`)?.status, "paid");
    page = String(await as(`${base}?state=open`, () => render(node)));
    assert(!page.includes("data-assign"));
  });
});
