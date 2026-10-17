import { assertEquals, assertStringIncludes } from "@std/assert";

import { backendNode, inRequest, withFinApp } from "../../tests/app.ts";
import api from "../nodeApi.ts";
import { render } from "../render.ts";
import { backendDashboardWidget } from "../plugin.ts";

type Answer = { ok: boolean; message?: string };

Deno.test("subscriptions are added, billed from the run, canceled, and deleted only unbilled", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.subscription"], async (app) => {
    const node = backendNode(app, "/backend/subscriptions");
    const base = "http://qino.test/backend/subscriptions";
    const as = (run: () => Promise<unknown>) => inRequest(app, base, run);
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster", organization: "Muster AG",
    }));
    const today = new Date().toLocaleDateString("sv-SE");
    const add = (name: string) =>
      as(() => api(node, { subscribe: { usrId: String(usr), name, price: "240", currency: "chf", start: today } }));
    await add("Hosting example.ch");
    assertStringIncludes(String(await as(() => backendDashboardWidget(app))), "<b>1</b>");
    let page = String(await as(() => render(node)));
    assertStringIncludes(page, "Hosting example.ch");
    assertStringIncludes(page, "data-action=bill");

    const billed = await as(() => api(node, { bill: true })) as Answer;
    assertEquals(billed.message?.startsWith("1 "), true); // one customer, one invoice
    await add("Typo");
    const [hosting, typo] = (await app.db.col`SELECT id FROM subscription ORDER BY id`).map(Number);
    assertEquals((await as(() => api(node, { remove: String(hosting) })) as Answer).ok, false); // billed
    await as(() => api(node, { cancel: String(hosting) }));
    assertEquals((await as(() => api(node, { remove: String(typo) })) as Answer).ok, true); // never billed
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM subscription`), 1);
    page = String(await as(() => render(node)));
    assertStringIncludes(page, "Nothing to bill");
  });
});

Deno.test("a subscription is changed on its page: start and period only until billed", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.subscription"], async (app) => {
    const node = backendNode(app, "/backend/subscriptions");
    const as = (run: () => Promise<unknown>) => inRequest(app, "http://qino.test/backend/subscriptions", run);
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster",
    }));
    const today = new Date().toLocaleDateString("sv-SE");
    const hosting = { usrId: String(usr), name: "Hosting", price: "240", currency: "CHF", start: today };
    await as(() => api(node, { subscribe: hosting }));
    const id = Number(await app.db.one`SELECT id FROM subscription`);
    const page = async () =>
      String(await inRequest(app, `http://qino.test/?subscription=${id}`, () => render(node)));
    assertStringIncludes(await page(), 'value="240"');
    const change = {
      id: String(id), name: "Hosting Plus", price: "300", start: "2030-01-01", unit: "month", count: "3",
    };
    await as(() => api(node, { update: { ...change, end: "2031-01-01" } }));
    let row = await app.db.row`SELECT * FROM subscription WHERE id = ${id}`;
    assertEquals(
      [row?.name, row?.price, row?.interval_unit, row?.end_date],
      ["Hosting Plus", 30000, "month", "2031-01-01"],
    );

    await app.db.table("subscription_invoice").insert({
      subscription_id: id, period_start: "2030-01-01", period_end: "2030-03-31", invoice_id: 1,
    });
    assertStringIncludes(await page(), "disabled"); // billed: start and period stay
    const refused = await as(() => api(node, { update: { ...change, start: "2029-01-01" } })).catch((e) => e);
    assertStringIncludes(String(refused), "billed already");
    await as(() => api(node, { update: { id: String(id), name: "Hosting Plus", price: "300", end: "" } }));
    row = await app.db.row`SELECT * FROM subscription WHERE id = ${id}`;
    assertEquals(row?.end_date, null); // runs on again
  });
});

Deno.test("plans are kept in the catalog and chosen for a subscription", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.subscription"], async (app) => {
    const node = backendNode(app, "/backend/subscriptions");
    const as = (run: () => Promise<unknown>) => inRequest(app, "http://qino.test/backend/subscriptions", run);
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster",
    }));
    await as(() => api(node, { plan: { name: "Hosting Light", price: "240", currency: "chf", unit: "year" } }));
    const planId = Number(await app.db.one`SELECT id FROM subscription_plan`);
    const start = new Date().toLocaleDateString("sv-SE");
    await as(() => api(node, { subscribe: { usrId: String(usr), planId: String(planId), name: "example.ch", start } }));
    const s = await app.db.row`SELECT * FROM subscription`;
    assertEquals([s?.plan_id, s?.name, s?.price], [planId, "example.ch", null]); // the price is the plan's
    const page = String(await as(() => render(node)));
    for (const part of ["Hosting Light", "example.ch", "1×"]) assertStringIncludes(page, part);
    assertEquals((await as(() => api(node, { removePlan: String(planId) })) as Answer).ok, false); // in use
  });
});
