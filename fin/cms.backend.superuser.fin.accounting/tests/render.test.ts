import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { create, issue } from "@qino/qino/fin.invoice";

import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import api from "../nodeApi.ts";
import { render } from "../render.ts";

type Answer = { ok: boolean; message?: string; url?: string };

const FIN = ["fin.payment", "fin.invoice", "fin.accounting", "fin.accounting.ch"];
const BASE = "http://qino.test/backend/accounting";

Deno.test("statements, journal and an entry by hand, its detail and its reversal", async () => {
  await withFinApp(FIN, async (app) => {
    const node = backendNode(app, "/backend/accounting");
    const year = new Date().getFullYear();
    await issue(app, await create(app, { currency: "CHF", date: `${year}-03-01`, lines: [{ name: "Design", price: 100000, taxRate: 8.1 }] }));
    const booked = await inRequest(app, BASE, () => api(node, {
      book: { date: `${year}-03-02`, text: "Rent <March>", account0: "6000", debit0: "1'800.00", account1: "1020", credit1: "1800" },
    })) as Answer;
    assertEquals(booked.ok, true, booked.message);
    const id = Number(new URL(booked.url!, "http://-").searchParams.get("entry"));

    const page = String(await inRequest(app, BASE, () => render(node))).replaceAll(" ", " ");
    // 1'000 revenue less 1'800 rent: a loss of 800
    for (const part of ["Balance sheet", "Rent &lt;March&gt;", "1100 Forderungen", "CHF 1,081.00", "Loss", "CHF 800.00"]) {
      assertStringIncludes(page, part);
    }
    const detail = String(await inRequest(app, `${BASE}?entry=${id}`, () => render(node)));
    assertStringIncludes(detail, "data-reverse");
    const back = await inRequest(app, BASE, () => api(node, { reverse: String(id) })) as Answer;
    assertEquals(back.ok, true);
    const again = String(await inRequest(app, `${BASE}?entry=${id}`, () => render(node)));
    assert(!again.includes("data-reverse"));
    assertStringIncludes(again, "Reversed by");

    const wrong = await inRequest(app, BASE, () => api(node, {
      book: { date: `${year}-03-02`, text: "x", account0: "6000", debit0: "10", account1: "1020", credit1: "9" },
    })) as Answer;
    assertEquals([wrong.ok, wrong.message?.includes("zero")], [false, true]);
  });
});

Deno.test("a year is closed from its card, which lists what is still open, and opened again", async () => {
  await withFinApp(FIN, async (app) => {
    const node = backendNode(app, "/backend/accounting");
    const base = "http://qino.test/backend/accounting";
    await create(app, { currency: "CHF", date: "2025-06-01", lines: [{ name: "Draft", price: 100 }] });
    let page = String(await inRequest(app, base, () => render(node)));
    assertStringIncludes(page, `value="${new Date().getFullYear() - 1}-12-31"`); // last year, proposed
    assertStringIncludes(page, "draft invoices of the year");
    const closed = await inRequest(app, base, () => api(node, { close: { until: "2025-12-31" } }));
    assertEquals((closed as Answer).ok, true);
    page = String(await inRequest(app, base, () => render(node)));
    assertStringIncludes(page, 'value="2026-12-31"'); // the next one, a year on
    await inRequest(app, base, () => api(node, { reopen: true }));
    assertEquals(await app.settings["fin.accounting"].closedUntil, "");
  });
});
