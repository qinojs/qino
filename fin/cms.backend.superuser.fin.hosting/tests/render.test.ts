import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { link, save } from "@qino/qino/fin.hosting";
import { subscribe } from "@qino/qino/fin.subscription";

import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import api from "../nodeApi.ts";
import { backendDashboardWidget, backendRowWidget } from "../plugin.ts";
import { render } from "../render.ts";

import type { App } from "@qino/qino";

const FIN = ["fin.payment", "fin.invoice", "fin.subscription", "fin.hosting"];
const BASE = "http://qino.test/backend/domains";

type Answer = { ok: boolean; message?: string; url?: string };

const customer = (app: App, organization: string) =>
  app.db.table("usr").insert({ active: 1, pw: "", superuser: 0, given_name: "", family_name: "", organization }).then(Number);

Deno.test("domains: the list shows owner, aliases and billing, flags what a customer is not billed for", async () => {
  await withFinApp(FIN, async (app) => {
    const node = backendNode(app, "/backend/domains");
    const anna = await customer(app, "Anna AG");
    await save(app, "anna.ch", { usrId: anna, registrar: "Hostpoint" });
    await save(app, "anna.com", { aliasOf: "anna.ch" });
    await save(app, "unbilled.ch", { usrId: anna });
    await save(app, "ours.ch");
    await link(app, "anna.ch", await subscribe(app, { usrId: anna, name: "Hosting anna.ch", price: 24000, currency: "CHF", start: "2026-01-01" }));

    const page = String(await inRequest(app, BASE, () => render(node)));
    assertStringIncludes(page, `<a href="/backend/domains?domain=anna.ch">anna.ch</a>`);
    assertStringIncludes(page, `<small>↳</small> <a href="/backend/domains?domain=anna.com">`);
    assert(/Hosting anna\.ch <small>CHF\s240\.00 \/ year<\/small>/.test(page)); // Intl puts a no-break space
    assertEquals(page.match(/not billed/g)?.length, 2); // unbilled.ch and the alias anna.com — not ours.ch
    assertStringIncludes(page, "Anna AG");

    const filtered = String(await inRequest(app, `${BASE}?search=ours`, () => render(node)));
    assert(filtered.includes("ours.ch") && !filtered.includes("?domain=anna.ch"));

    assertStringIncludes(String(await inRequest(app, BASE, () => backendDashboardWidget(app))), "<b>4</b>");
    const card = String(await inRequest(app, BASE, async () => backendRowWidget.usr(app, anna, await node.page())));
    assertStringIncludes(card, "anna.com");
    assertEquals(String(await inRequest(app, BASE, async () => backendRowWidget.usr(app, anna + 1, await node.page()))), "");
  });
});

Deno.test("domains: one is added, changed, linked, unlinked and removed; refusals come back as message", async () => {
  await withFinApp(FIN, async (app) => {
    const node = backendNode(app, "/backend/domains");
    const as = (run: () => Promise<unknown>) => inRequest(app, BASE, run) as Promise<Answer>;
    const anna = await customer(app, "Anna AG");
    // named after no domain: nothing links it by itself, here it is done by hand
    const sub = await subscribe(app, { usrId: anna, name: "Domain", price: 2500, currency: "CHF", start: "2026-01-01" });

    const added = await as(() => api(node, { save: { name: "Anna.CH", usrId: String(anna), aliasOf: "", registrar: "" } }));
    assertEquals(added.url, "/backend/domains?domain=anna.ch");
    assertEquals((await as(() => api(node, { save: { name: "nonsense", usrId: "" } }))).message, "not a domain: nonsense");

    const detail = String(await inRequest(app, `${BASE}?domain=anna.ch`, () => render(node)));
    assertStringIncludes(detail, `<option value="${sub}">Domain`); // the owner's subscription, ready to link
    assertStringIncludes(detail, "data-remove=");

    await as(() => api(node, { link: { id: "anna.ch", subscription: String(sub) } }));
    const linked = String(await inRequest(app, `${BASE}?domain=anna.ch`, () => render(node)));
    assertStringIncludes(linked, `data-unlink="${sub}"`);
    assertStringIncludes(linked, "It cannot be removed: Subscriptions still run for it.</small>");
    assertEquals((await as(() => api(node, { remove: "anna.ch" }))).ok, false);

    await as(() => api(node, { unlink: { id: "anna.ch", subscription: String(sub) } }));
    assertEquals((await as(() => api(node, { save: { id: "anna.ch", usrId: String(anna), aliasOf: "", registrar: "Infomaniak" } }))).ok, true);
    assertEquals(await app.db.one`SELECT registrar FROM fin_hosting_domain WHERE name = 'anna.ch'`, "Infomaniak");
    assertEquals((await as(() => api(node, { remove: "anna.ch" }))).url, "/backend/domains");
    assertStringIncludes(String(await inRequest(app, `${BASE}?domain=anna.ch`, () => render(node))), "No domain anna.ch");
  });
});

Deno.test("domains: an alias's page offers no customer — it is its domain's — but its own subscriptions to link", async () => {
  await withFinApp(FIN, async (app) => {
    const node = backendNode(app, "/backend/domains");
    const anna = await customer(app, "Anna AG");
    await save(app, "anna.ch", { usrId: anna });
    await save(app, "anna.com", { aliasOf: "anna.ch" });
    await subscribe(app, { usrId: anna, name: "Hosting", price: 24000, currency: "CHF", start: "2026-01-01" });
    const page = String(await inRequest(app, `${BASE}?domain=anna.com`, () => render(node)));
    assert(!page.includes("name=usrId") && page.includes("data-link="));
    assertStringIncludes(page, `<option selected>anna.ch`);
    // saved without a customer field, it stays its domain's
    await inRequest(app, BASE, () => api(node, { save: { id: "anna.com", aliasOf: "anna.ch", registrar: "x" } }));
    assertEquals(await app.db.one`SELECT usr_id FROM fin_hosting_domain WHERE name = 'anna.com'`, anna);
  });
});
