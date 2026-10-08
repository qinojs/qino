import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { create, issue } from "@qino/qino/fin.invoice";

import api from "../nodeApi.ts";
import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import { render } from "../render.ts";
import { cms } from "../plugin.ts";

type Answer = { ok: boolean; message?: string; url?: string };

Deno.test("customers and suppliers follow from the invoices; a new one keeps its address here", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.payment.credit"], async (app) => {
    const node = backendNode(app, "/backend/parties");
    const as = (url: string, run: () => Promise<unknown>) => inRequest(app, url, run);
    const base = "http://qino.test/backend/parties";

    const made = await as(base, () => api(node, { create: { organization: "Druck AG" } })) as Answer;
    const id = Number(new URL(made.url!, "http://-").searchParams.get("usr"));
    assertEquals((await app.db.row`SELECT active FROM usr WHERE id = ${id}`)?.active, 0); // no login
    const address = {
      street_address: "Seeweg 2", postal_code: "3000", address_locality: "Bern", address_country: "ch",
    };
    await as(base, () => api(node, { save: { organization: "Druck AG", ...address, id: String(id) } }));
    assertEquals((await app.db.row`SELECT address_country FROM usr WHERE id = ${id}`)?.address_country, "CH");
    assertEquals(String(await as(base, () => render(node))).includes("Druck AG"), false); // no invoice yet

    const lines = [{ name: "Print", price: 10000 }];
    await issue(app, await create(app, { direction: "in", number: "R-1", currency: "CHF", lines, usrId: id }));
    let page = String(await as(base, () => render(node)));
    assertStringIncludes(page, "Druck AG");
    assertStringIncludes(page, "supplier");
    assert(!String(await as(`${base}?role=customer`, () => render(node))).includes("Druck AG"));

    await issue(app, await create(app, { currency: "CHF", lines, usrId: id })); // it buys too
    assertStringIncludes(String(await as(`${base}?role=customer`, () => render(node))), "Druck AG");
    await as(base, () => api(node, { credit: { id: String(id), amount: "5", currency: "CHF", text: "Start" } }));
    assertStringIncludes(String(await as(base, () => render(node))), "5.00</span>"); // credit in the list
    page = String(await as(`${base}?usr=${id}`, () => render(node)));
    const parts = ['value="Seeweg 2"', "R-1", `data-save="${id}"`, `data-credit="${id}"`];
    for (const part of parts) assertStringIncludes(page, part);
    const goodwill = { id: String(id), amount: "12.50", currency: "chf", text: "Goodwill" };
    await as(base, () => api(node, { credit: goodwill }));
    assertStringIncludes(String(await as(`${base}?usr=${id}`, () => render(node))), "Goodwill");
  });
});

Deno.test("the page speaks with the texts of the namespace fin", async () => {
  await withFinApp(["fin.payment", "fin.invoice"], async (app) => {
    app.languages.setLangs(["en", "de"]);
    const node = backendNode(app, "/backend/parties");
    const page = String(await inRequest(app, "http://qino.test/backend/parties", () =>
      app.languages.with({ lang: "de" }, () => cms.node.render(node))));
    assertStringIncludes(page, "Kunden &amp; Lieferanten");
  });
});
