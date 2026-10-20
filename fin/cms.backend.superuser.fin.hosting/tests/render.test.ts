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

Deno.test("domains: the list shows owner, aliases, host and billing, flags what is not billed for registration or hosting", async () => {
  await withFinApp(FIN, async (app) => {
    const node = backendNode(app, "/backend/domains");
    const anna = await customer(app, "Anna AG");
    await save(app, "anna.ch", { usrId: anna, registrar: "Hostpoint", host: "plesk:s3" });
    await save(app, "anna.com", { aliasOf: "anna.ch", registrar: "infomaniak" }); // its own registration: to bill
    await save(app, "unbilled.ch", { usrId: anna, host: "plesk:s3" }); // registered by the customer, hosted by us
    await save(app, "theirs.ch", { usrId: anna }); // the customer keeps it elsewhere: nothing to bill
    await save(app, "ours.ch", { registrar: "infomaniak", domainFree: true });
    await save(app, "nobodys.ch", { registrar: "infomaniak" });
    const sub = await subscribe(app, { usrId: anna, name: "Webspace", price: 24000, currency: "CHF", start: "2026-01-01" });
    await link(app, "anna.ch", sub, "hosting");

    const page = String(await inRequest(app, BASE, () => render(node)));
    assertStringIncludes(page, `<a href="/backend/domains?domain=anna.ch">anna.ch</a>`);
    assertStringIncludes(page, `<small>↳</small> <a href="/backend/domains?domain=anna.com">`);
    assert(/<small>Hosting<\/small> Webspace <small>CHF\s240\.00 \/ year<\/small>/.test(page)); // Intl puts a no-break space
    const row = (name: string) => page.slice(page.lastIndexOf(`>${name}</a>`)).split("<tr>")[0];
    assertStringIncludes(row("anna.ch"), "Domain not billed"); // its hosting is, its registration not
    assert(!row("anna.ch").includes("Hosting not billed"));
    assertStringIncludes(row("unbilled.ch"), "Hosting not billed");
    assertStringIncludes(row("unbilled.ch"), "plesk:s3");
    assertStringIncludes(row("ours.ch"), "Domain free");
    assert(!row("theirs.ch").includes("not billed"));
    assertStringIncludes(page, `>no customer</small>`);
    assertStringIncludes(page, "Anna AG");

    const filtered = String(await inRequest(app, `${BASE}?search=ours`, () => render(node)));
    assert(filtered.includes("ours.ch") && !filtered.includes("?domain=anna.ch"));

    assertStringIncludes(String(await inRequest(app, BASE, () => backendDashboardWidget(app))), "<b>6</b> domains · <small class=u2-badge style=\"background:var(--orange)\">4 to do");
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

    await as(() => api(node, { link: { id: "anna.ch", subscription: String(sub), kind: "domain" } }));
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${sub}`, "fin.hosting:anna.ch/domain");
    const linked = String(await inRequest(app, `${BASE}?domain=anna.ch`, () => render(node)));
    assertStringIncludes(linked, `data-unlink="${sub}"`);
    assertStringIncludes(linked, "It cannot be removed: Subscriptions still run for it.</small>");
    assertEquals((await as(() => api(node, { remove: "anna.ch" }))).ok, false);

    await as(() => api(node, { unlink: { id: "anna.ch", subscription: String(sub) } }));
    const saved = { id: "anna.ch", usrId: String(anna), aliasOf: "", registrar: "Infomaniak", host: "plesk:s3", hostingFree: "1" };
    assertEquals((await as(() => api(node, { save: saved }))).ok, true);
    const row = await app.db.row`SELECT registrar, host, domain_free, hosting_free FROM fin_hosting_domain WHERE name = 'anna.ch'`;
    assertEquals([row?.registrar, row?.host, !!row?.domain_free, !!row?.hosting_free], ["Infomaniak", "plesk:s3", false, true]);
    assertEquals((await as(() => api(node, { remove: "anna.ch" }))).url, "/backend/domains");
    assertStringIncludes(String(await inRequest(app, `${BASE}?domain=anna.ch`, () => render(node))), "No domain anna.ch");
  });
});

Deno.test("domains: an alias's page offers no customer and no host — they are its domain's — but its own subscriptions to link", async () => {
  await withFinApp(FIN, async (app) => {
    const node = backendNode(app, "/backend/domains");
    const anna = await customer(app, "Anna AG");
    await save(app, "anna.ch", { usrId: anna });
    await save(app, "anna.com", { aliasOf: "anna.ch" });
    await subscribe(app, { usrId: anna, name: "Hosting", price: 24000, currency: "CHF", start: "2026-01-01" });
    const page = String(await inRequest(app, `${BASE}?domain=anna.com`, () => render(node)));
    assert(!page.includes("name=usrId") && !page.includes("name=host") && page.includes("data-link="));
    assert(!page.includes("<option value=hosting>")); // nor a hosting to link
    assertStringIncludes(page, `<option selected>anna.ch`);
    // saved without a customer field, it stays its domain's
    await inRequest(app, BASE, () => api(node, { save: { id: "anna.com", aliasOf: "anna.ch", registrar: "x" } }));
    assertEquals(await app.db.one`SELECT usr_id FROM fin_hosting_domain WHERE name = 'anna.com'`, anna);
  });
});
