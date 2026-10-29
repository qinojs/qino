import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { create } from "@qino/qino/fin.invoice";
import { render as pdf } from "@qino/qino/pdf";

import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import { partsOf, supplierOf, valuesOf } from "../lib/read.ts";
import api from "../nodeApi.ts";
import { render } from "../render.ts";

import type { App } from "@qino/qino";

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.invoice"], fn);

Deno.test("what the model read becomes a received draft, in minor units", () => {
  const values = valuesOf({
    supplier: { name: "Hosting AG", street: "Seeweg 2", postalCode: "3000", city: "Bern", country: "ch", iban: "CH93 0076 2011 6238 5295 7" },
    number: "R-778",
    date: "2026-10-01",
    due: "30 Tage",
    currency: "chf",
    lines: [{ name: "Server", quantity: 1, unitPrice: 99, taxRate: 8.1 }, { name: "Power", quantity: 100, unit: "kWh", unitPrice: 0.2345, taxRate: 8.1 }],
    total: 132.37,
    reference: "RF18539007547034",
  });
  assertEquals([values.direction, values.currency, values.number, values.date, values.due], ["in", "CHF", "R-778", "2026-10-01", undefined]);
  assertEquals(values.party, {
    name: "Hosting AG",
    address: { streetAddress: "Seeweg 2", postalCode: "3000", addressLocality: "Bern", addressCountry: "CH" },
    iban: "CH9300762011623852957",
  });
  assertEquals(values.lines.map((l) => l.price), [9900, 23.45]);
  assertEquals(values.data.read, { total: 13237, reference: "RF18539007547034" });
});

Deno.test("a PDF is shown as its text, one without text as its pages; anything else is refused", async () => {
  if ((await Deno.permissions.query({ name: "run" })).state !== "granted") return; // no browser to make a PDF
  await withApp(async (app) => {
    const fileOf = async (body: string) =>
      app.dbFiles.add(new File([await pdf(app, body)], "invoice.pdf", { type: "application/pdf" }));
    const text = await fileOf("<p>Rechnung R-778 Total CHF 132.37, zahlbar in 30 Tagen</p>").catch(() => undefined);
    if (text) {
      const [part] = await partsOf(text);
      assertStringIncludes(part.type === "text" ? part.text : "", "Rechnung R-778");
      const scan = await fileOf('<div style="width:5cm; height:2cm; background:#000"></div>');
      const parts = await partsOf(scan);
      assertEquals(parts.map((p) => p.type), ["image"]);
    }
    const node = backendNode(app, "/backend/inbox");
    const answer = await inRequest(app, "http://qino.test/", () =>
      api(node, { read: [{ name: "notes.txt", type: "text/plain", data: btoa("hello") }] })) as { ok: boolean; message: string };
    assertEquals(answer.ok, false);
    assertStringIncludes(answer.message, "PDF or image only");
  });
});

Deno.test("drafts to check are listed; a total that does not match what was read is marked", async () => {
  await withApp(async (app) => {
    const read = { supplier: { name: "Hosting AG" }, currency: "CHF", lines: [{ name: "Server", quantity: 1, unitPrice: 99, taxRate: 0 }], total: 100 };
    await create(app, valuesOf(read));
    const page = String(await inRequest(app, "http://qino.test/backend/inbox", () => render(backendNode(app, "/backend/inbox"))))
      .replaceAll(" ", " ");
    assertStringIncludes(page, "Hosting AG");
    assertStringIncludes(page, '<small class=u2-badge style="background:var(--red)">CHF 100.00</small>'); // read 100, the lines make 99
    assert(page.includes("data-read"));
  });
});

Deno.test("a read invoice finds its supplier by IBAN or name, else one is created by hand", async () => {
  await withApp(async (app) => {
    const known = Number(await app.db.table("usr").insert({
      organization: "Hosting AG", given_name: "", family_name: "", active: 0, pw: "", superuser: 0,
    }));
    const read = { currency: "CHF", lines: [{ name: "Server", quantity: 1, unitPrice: 99, taxRate: 0 }], total: 99 };
    assertEquals(await supplierOf(app, { name: "hosting ag" }), known);
    assertEquals(await supplierOf(app, { name: "Elsewhere", iban: "CH9300762011623852957" }), null);

    const node = backendNode(app, "/backend/inbox");
    const supplier = { name: "Druck AG", iban: "CH93 0076 2011 6238 5295 7" };
    const draft = await create(app, valuesOf({ ...read, supplier }));
    const made = await inRequest(app, "http://qino.test/", () => api(node, { supplier: String(draft) }));
    assertEquals((made as { ok: boolean }).ok, true);
    const usr = await app.db.row`SELECT u.* FROM usr u JOIN invoice i ON i.usr_id = u.id WHERE i.id = ${draft}`;
    assertEquals([usr?.organization, usr?.iban, usr?.active], ["Druck AG", "CH9300762011623852957", 0]);
    // the next one from there finds it by its IBAN
    assertEquals(await supplierOf(app, { name: "Druck", iban: "CH9300762011623852957" }), Number(usr?.id));
  });
});
