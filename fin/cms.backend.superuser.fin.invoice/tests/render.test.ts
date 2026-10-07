import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import api from "../nodeApi.ts";
import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import { render } from "../render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const FIN = ["fin.payment", "fin.bank", "fin.payment.qrbill", "fin.invoice"];

type Answer = { ok: boolean; message?: string; url?: string };

type As = (url: string, run: () => Promise<unknown>) => Promise<unknown>;

const withApp = (fn: (app: App, as: As, node: Node) => Promise<void>) =>
  withFinApp(FIN, async (app) => {
    await app.settings["fin.payment.qrbill"].iban("CH44 3199 9123 0008 8901 2");
    await fn(app, (url, run) => inRequest(app, url, run), backendNode(app, "/backend/invoices"));
  });

/** What the editor sends: every field of the form, the second line left empty. */
const edited = {
  currency: "chf", title: "", name: "Kunde & Co", streetAddress: "Seeweg 2", postalCode: "3000",
  addressLocality: "Bern", addressCountry: "ch", vatID: "", usrId: "", gross: "", text: "Danke",
  date: "", due: "", lang: "",
  title0: "Design", qty0: "2,5", unit0: "h", price0: "120.00", taxRate0: "8.1",
  title1: "", qty1: "", unit1: "", price1: "", taxRate1: "",
  title5: "Hosting", qty5: "", unit5: "", price5: "99", taxRate5: "8.1",
};

Deno.test("a new invoice opens in the editor, saves as one types, is issued, asked for and paid", async () => {
  await withApp(async (app, as, node) => {
    const base = "http://qino.test/backend/invoices";
    const created = await as(base, () => api(node, { create: { direction: "out", currency: "chf" } })) as Answer;
    const id = Number(new URL(created.url!, "http://-").searchParams.get("invoice"));
    let page = String(await as(`${base}?invoice=${id}`, () => render(node)));
    for (const part of [`data-edit="${id}"`, "data-preview", "data-add-line", "data-action=remove"]) assertStringIncludes(page, part);

    const saved = await as(base, () => api(node, { save: { ...edited, id: String(id) } })) as Answer & { html: string };
    assertEquals(saved.ok, true, saved.message);
    for (const part of ["Kunde &amp; Co", "Design", "Hosting", "Danke"]) assertStringIncludes(saved.html, part); // the preview
    const row = await app.db.row`SELECT * FROM invoice WHERE id = ${id}`;
    assertEquals([row?.status, row?.currency, row?.net, row?.tax, row?.total], ["draft", "CHF", 39900, 3232, 43132]);
    assertEquals(JSON.parse(String(row?.party)).address.addressCountry, "CH");
    page = String(await as(`${base}?invoice=${id}`, () => render(node)));
    assertStringIncludes(page, 'value="120"'); // prices come back as typed
    await as(base, () => api(node, { save: { ...edited, text: "", id: String(id) } }));
    assertEquals((await app.db.row`SELECT text FROM invoice WHERE id = ${id}`)?.text, ""); // emptied is cleared
    await app.db.exec`UPDATE invoice SET ref = ${"shop.order:12"} WHERE id = ${id}`; // as a shop would
    await as(base, () => api(node, { save: { ...edited, id: String(id) } }));
    assertEquals((await app.db.row`SELECT ref FROM invoice WHERE id = ${id}`)?.ref, "shop.order:12"); // saving keeps it

    const issued = await as(base, () => api(node, { action: { action: "issue", id: String(id) } })) as Answer;
    assertStringIncludes(issued.message!, `${new Date().getFullYear()}-1`);
    page = String(await as(`${base}?invoice=${id}`, () => render(node)));
    assertStringIncludes(page, "data-request"); // the QR bill is offered for the open amount
    assert(!page.includes("data-action=issue"));

    const asked = await as(base, () => api(node, { request: { id: String(id), method: "qrbill" } })) as Answer;
    assertStringIncludes(asked.message!, "/payment/pay/");
    await as(base, () => api(node, { record: { id: String(id), amount: "", provider: "cash" } }));
    assertEquals((await app.db.row`SELECT status, paid FROM invoice WHERE id = ${id}`)?.status, "paid");

    const overview = String(await as(base, () => render(node)));
    assertStringIncludes(overview, "Kunde &amp; Co");
    assertStringIncludes(overview, "/api/core/settings/fin.invoice");
    assert(!String(await as(`${base}?overdue=1`, () => render(node))).includes("Kunde &amp; Co"));
  });
});

Deno.test("a draft is thrown away; an unpaid issued invoice is revised into a new draft", async () => {
  await withApp(async (app, as, node) => {
    const base = "http://qino.test/backend/invoices";
    const action = (name: string, id: number) => as(base, () => api(node, { action: { action: name, id: String(id) } })) as Promise<Answer>;
    const make = async () => {
      const created = await as(base, () => api(node, { create: { direction: "out", currency: "CHF" } })) as Answer;
      const id = Number(new URL(created.url!, "http://-").searchParams.get("invoice"));
      await as(base, () => api(node, { save: { ...edited, id: String(id) } }));
      return id;
    };
    const draft = await make();
    await action("remove", draft);
    assertEquals(await app.db.row`SELECT id FROM invoice WHERE id = ${draft}`, undefined);

    const id = await make();
    await action("issue", id);
    assertStringIncludes(String(await as(`${base}?invoice=${id}`, () => render(node))), "data-action=revise");
    const revised = await action("revise", id);
    const copy = Number(new URL(revised.url!, "http://-").searchParams.get("invoice"));
    assertEquals((await app.db.row`SELECT status FROM invoice WHERE id = ${id}`)?.status, "canceled");
    assertEquals((await app.db.row`SELECT status, total FROM invoice WHERE id = ${copy}`)?.total, 43132);
  });
});
