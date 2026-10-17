import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ingest } from "@qino/qino/fin.bank";
import { create } from "@qino/qino/fin.payment";

import api from "../nodeApi.ts";
import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import { render } from "../render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const FIN = ["fin.payment", "fin.bank", "fin.payment.qrbill"];

/** A real app with payments, bank and the QR bill, and a backend node without a CMS around it. */
type As = (url: string, run: () => Promise<unknown>) => Promise<unknown>;

const withApp = (fn: (app: App, as: As, node: Node) => Promise<void>) =>
  withFinApp(FIN, async (app) => {
    await app.settings["fin.payment.qrbill"].iban("CH44 3199 9123 0008 8901 2");
    await fn(app, (url, run) => inRequest(app, url, run), backendNode(app, "/backend/payments"));
  });

Deno.test("the overview lists and filters payments and shows the providers with their settings", async () => {
  await withApp(async (app, as, node) => {
    await create(app, { method: "qrbill", amount: 47226, currency: "CHF", ref: "shop.order:1", description: "Order <1>", return: "/" });
    await as("http://qino.test/backend/payments", () => api(node, {
      record: { direction: "out", provider: "cash", amount: "12,50", currency: "chf", ref: "", description: "Kasse" },
    }));
    const all = String(await as("http://qino.test/backend/payments", () => render(node)));
    for (const part of ["Order &lt;1&gt;", "Kasse", "qrbill", "cash", "pending", "QR-bill", "/api/core/settings/fin.payment.qrbill"]) {
      assertStringIncludes(all, part);
    }
    assertStringIncludes(all.replaceAll("\u00a0", " "), "CHF 12.50"); // typed as 12,50
    const paid = String(await as("http://qino.test/backend/payments?status=paid", () => render(node)));
    assertStringIncludes(paid, "Kasse");
    assert(!paid.includes("Order &lt;1&gt;"));
  });
});

Deno.test("the detail shows every field, the bank lines and the slip; sync asks again", async () => {
  await withApp(async (app, as, node) => {
    const { id } = await create(app, { method: "qrbill", amount: 50000, currency: "CHF", return: "/" });
    const reference = String(await app.db.one`SELECT external_id FROM payment WHERE id = ${id}`);
    await ingest(app, {
      account: "CH4431999123000889012",
      currency: "CHF",
      transactions: [{ id: "1", date: "2026-10-07", amount: 20000, reference, partyName: "Kunde" }],
    });
    const page = String(await as(`http://qino.test/backend/payments?payment=${id}`, () => render(node)));
    for (const part of ["processing", reference, "Kunde", "<svg"]) assertStringIncludes(page, part);
    const answer = await as("http://qino.test/", () => api(node, { sync: id })) as { ok: boolean; message: string };
    assertEquals(answer.ok, true);
    assertStringIncludes(answer.message, "processing");
  });
});

Deno.test("what cannot be done says so instead of failing", async () => {
  await withApp(async (_app, as, node) => {
    const refund = await as("http://qino.test/", () => api(node, { refund: { id: "999", amount: "" } })) as { ok: boolean };
    assertEquals(refund.ok, false);
    const record = await as("http://qino.test/", () =>
      api(node, { record: { direction: "in", provider: "cash", amount: "abc", currency: "CHF" } })) as { ok: boolean };
    assertEquals(record.ok, false);
  });
});
