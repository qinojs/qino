import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { create, issue } from "@qino/qino/fin.invoice";
import { setTransport } from "@qino/qino/messaging.email";

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
  currency: "chf", name: "Kunde & Co", streetAddress: "Seeweg 2", postalCode: "3000",
  addressLocality: "Bern", addressCountry: "ch", vatID: "", usrId: "", taxIncluded: "", text: "Danke",
  date: "", term: "", lang: "",
  name0: "Design", description0: "Logo & colours", quantity0: "2,5", unit0: "h", price0: "120.00", taxRate0: "8.1",
  name1: "", quantity1: "", unit1: "", price1: "", taxRate1: "",
  name5: "Hosting", quantity5: "", unit5: "", price5: "99", taxRate5: "8.1",
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
    for (const part of ["Kunde &amp; Co", "Design", "Logo &amp; colours", "Hosting", "Danke"]) assertStringIncludes(saved.html, part); // the preview
    const row = await app.db.row`SELECT * FROM invoice WHERE id = ${id}`;
    assertEquals([row?.status, row?.currency, row?.net, row?.tax, row?.total], ["draft", "CHF", 39900, 3232, 43132]);
    assertEquals(JSON.parse(String(row?.party)).address.addressCountry, "CH");
    // the term is typed in days; the due date follows from it on issue
    await as(base, () => api(node, { save: { ...edited, term: "10", id: String(id) } }));
    assertStringIncludes(String(await as(`${base}?invoice=${id}`, () => render(node))), 'name=term min=0 value="10"');
    // a line dragged up: its fields come first, so it does
    const { name5, quantity5, unit5, price5, taxRate5, ...rest } = edited;
    await as(base, () => api(node, { save: { name5, quantity5, unit5, price5, taxRate5, ...rest, id: String(id) } }));
    assertEquals(await app.db.col`SELECT name FROM invoice_line WHERE invoice_id = ${id} ORDER BY sort`, ["Hosting", "Design"]);
    const viewed = await as(base, () => api(node, { pdf: String(id) })) as { pdf: string };
    assertEquals(atob(viewed.pdf).slice(0, 5), "%PDF-"); // the draft as PDF, not kept
    assertEquals((await app.db.row`SELECT file_id FROM invoice WHERE id = ${id}`)?.file_id, null);
    await as(base, () => api(node, { save: { ...edited, id: String(id) } }));
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

Deno.test("a received invoice shows its original beside the editor; the receipt is uploaded there", async () => {
  await withApp(async (_app, as, node) => {
    const base = "http://qino.test/backend/invoices";
    const created = await as(base, () => api(node, { create: { direction: "in", currency: "CHF" } })) as Answer;
    const id = Number(new URL(created.url!, "http://-").searchParams.get("invoice"));
    let page = String(await as(`${base}?invoice=${id}`, () => render(node)));
    assertStringIncludes(page, `data-attach="${id}"`);
    assert(!page.includes("data-preview")); // no print preview: the original is what counts
    const file = { name: "bill.png", type: "image/png", data: new Uint8Array([137, 80, 78, 71]).toBase64() };
    const attached = await as(base, () => api(node, { attach: { id: String(id), file } })) as Answer;
    assertEquals(attached.ok, true, attached.message);
    page = String(await as(`${base}?invoice=${id}`, () => render(node)));
    assertStringIncludes(page, "bill.png");
    assertStringIncludes(page, "<img");
  });
});

Deno.test("a user is picked and gives the invoice their name, address and language", async () => {
  await withApp(async (app, as, node) => {
    const id = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster", organization: "Muster AG",
      street_address: "Seeweg 2", postal_code: "3000", address_locality: "Bern", address_country: "CH", lang: "de",
    }));
    const draft = Number(await create(app, { currency: "CHF", lines: [], usrId: id }));
    const page = String(await as(`http://qino.test/?invoice=${draft}`, () => render(node)));
    assertStringIncludes(page, `<option value="${id}" selected>Anna Muster, Muster AG`);
    assertEquals(await as("http://qino.test/", () => api(node, { usr: String(id) })), {
      name: "Muster AG", streetAddress: "Seeweg 2", postalCode: "3000", addressLocality: "Bern",
      addressRegion: "", addressCountry: "CH", lang: "de",
    });
  });
});

Deno.test("an issued invoice is mailed with its PDF, in its language, to the address typed", async () => {
  await withFinApp([...FIN, "messaging", "messaging.email"], async (app) => {
    app.languages.setLangs(["en", "de"]);
    await app.settings["messaging.email"].address("office@atelier.test");
    const sent: Record<string, unknown>[] = [];
    setTransport(app, {
      send: (m) => (sent.push(m as Record<string, unknown>), Promise.resolve({ successful: true })),
    });
    const node = backendNode(app, "/backend/invoices");
    const lines = [{ name: "Design", price: 10000 }];
    const id = Number((await issue(app, await create(app, { currency: "CHF", lang: "de", lines })))?.id);
    const base = "http://qino.test/backend/invoices";
    const page = String(await inRequest(app, `${base}?invoice=${id}`, () => render(node)));
    assertStringIncludes(page, `data-send="${id}"`);
    const to = { id: String(id), email: "kunde@example.com" };
    const answer = await inRequest(app, base, () => api(node, { send: to }));
    assertEquals((answer as Answer).ok, true, (answer as Answer).message);
    assertEquals(String(sent[0].subject), `Rechnung ${new Date().getFullYear()}-1`);
    assertEquals((sent[0].attachments as unknown[]).length, 1); // the PDF, printed for it
    assert((await app.db.row`SELECT file_id FROM invoice WHERE id = ${id}`)?.file_id);
  });
});

Deno.test("a credit note is made from an invoice, and what it owes goes onto the customer's credit", async () => {
  await withFinApp([...FIN, "fin.payment.credit"], async (app) => {
    const node = backendNode(app, "/backend/invoices");
    const base = "http://qino.test/backend/invoices";
    const as = (run: () => Promise<unknown>) => inRequest(app, base, run);
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster",
    }));
    const lines = [{ name: "Design", price: 10000 }];
    const id = Number((await issue(app, await create(app, { currency: "CHF", usrId: usr, lines })))?.id);
    await as(() => api(node, { record: { id: String(id), amount: "", provider: "bank" } })); // paid in full
    const made = await as(() => api(node, { action: { action: "credit", id: String(id) } })) as Answer;
    const note = Number(new URL(made.url!, "http://-").searchParams.get("invoice"));
    await issue(app, note);
    const page = String(await as(() => inRequest(app, `${base}?invoice=${note}`, () => render(node))));
    for (const part of ["data-action=tocredit", "Paid back"]) assertStringIncludes(page, part);
    await as(() => api(node, { action: { action: "tocredit", id: String(note) } }));
    assertEquals((await app.db.row`SELECT status FROM invoice WHERE id = ${note}`)?.status, "paid");
    assertEquals(Number(await app.db.one`SELECT SUM(amount) FROM payment_credit WHERE usr_id = ${usr}`), 10000);
  });
});
