import { assertEquals } from "@std/assert";
import { lines, remove } from "@qino/qino/fin.invoice";
import { setTransport } from "@qino/qino/messaging.email";

import { withFinApp } from "../../tests/app.ts";
import { bill, cancel, periodAfter, plan, subscribe, subscriptions } from "../mod.ts";

Deno.test("periods follow from the start: months or years, the month's last day kept", () => {
  assertEquals(periodAfter("2027-03-01", "year", 1), "2028-03-01");
  assertEquals(periodAfter("2027-01-31", "month", 1), "2027-02-28");
  assertEquals(periodAfter("2027-11-15", "month", 3), "2028-02-15");
  assertEquals(periodAfter("2028-02-29", "year", 1), "2029-02-28");
});

Deno.test("what renews is billed in advance, one invoice per customer, and stops when canceled", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.subscription"], async (app) => {
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster", organization: "Muster AG",
      street_address: "Seeweg 2", postal_code: "3000", address_locality: "Bern", address_country: "CH",
    }));
    const add = (name: string, price: number, start: string) =>
      subscribe(app, { usrId: usr, name, price, currency: "CHF", start });
    const hosting = await add("Hosting example.ch", 24000, "2027-03-01");
    await add("Domain example.ch", 2500, "2027-03-15");
    await add("Later", 100, "2027-06-01");

    const [id] = await bill(app, { until: "2027-03-31" });
    assertEquals((await bill(app, { until: "2027-03-31" })).length, 0); // billed once
    const items = await lines(app, id);
    assertEquals(items.map((l) => [l.name, Number(l.price)]), [
      ["Hosting example.ch", 24000],
      ["Domain example.ch", 2500],
    ]);
    const invoice = await app.db.row`SELECT * FROM invoice WHERE id = ${id}`;
    const party = JSON.parse(String(invoice?.party));
    assertEquals([invoice?.status, invoice?.usr_id, party.name], ["draft", usr, "Muster AG"]);
    const next = Object.fromEntries((await subscriptions(app, usr)).map((s) => [s.name, s.next]));
    assertEquals(next["Hosting example.ch"], "2028-03-01");

    // a draft thrown away gives its periods back
    await remove(app, id);
    assertEquals((await subscriptions(app, usr)).find((s) => s.id === hosting)?.next, "2027-03-01");

    // missed years come all at once; canceled, nothing more
    const [later] = await bill(app, { until: "2029-03-10" });
    assertEquals((await lines(app, later)).filter((l) => l.name === "Hosting example.ch").length, 3);
    await cancel(app, hosting);
    const after = await bill(app, { until: "2030-03-10" });
    for (const one of after) assertEquals((await lines(app, one)).some((l) => l.name === "Hosting example.ch"), false);
  });
});

Deno.test("with send set, the invoices go out issued and by mail; without, nothing is mailed", async () => {
  const modules = ["fin.payment", "fin.invoice", "messaging", "messaging.email", "fin.subscription"];
  await withFinApp(modules, async (app) => {
    await app.settings["messaging.email"].address("office@atelier.test");
    const sent: unknown[] = [];
    setTransport(app, { send: (m) => (sent.push(m), Promise.resolve({ successful: true })) });
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster",
    }));
    await app.db.table("usr_contact").insert({ type: "email", address: "anna@example.com", usr_id: usr, main: 1 });
    const add = (start: string) =>
      subscribe(app, { usrId: usr, name: "Hosting", price: 24000, currency: "CHF", start });
    const status = async (id: number) => (await app.db.row`SELECT status FROM invoice WHERE id = ${id}`)?.status;
    await add("2027-03-01");
    const [draft] = await bill(app, { until: "2027-03-31" });
    assertEquals([await status(draft), sent.length], ["draft", 0]);

    await app.settings["fin.subscription"].send(true);
    await add("2027-04-01");
    const [mailed] = await bill(app, { until: "2027-04-30" });
    assertEquals([await status(mailed), sent.length], ["open", 1]);
  });
});

Deno.test("a plan fills in what a subscription leaves empty; its own fields win", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.subscription"], async (app) => {
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster",
    }));
    const light = await plan(app, { name: "Hosting Light", price: 24000, currency: "CHF" });
    const domain = await plan(app, { name: "Domain .ch", description: "DNS included", price: 2500, currency: "CHF" });
    await subscribe(app, { usrId: usr, planId: light, name: "example.ch", start: "2027-03-01" });
    await subscribe(app, { usrId: usr, planId: domain, name: "example.ch", price: 2000, start: "2027-03-01" });
    const [id] = await bill(app, { until: "2027-03-31" });
    const items = await lines(app, id);
    assertEquals(items.map((l) => [l.name, Number(l.price)]), [["Hosting Light", 24000], ["Domain .ch", 2000]]);
    assertEquals(String(items[0].description).startsWith("example.ch, "), true);
    assertEquals(String(items[1].description).split("\n")[1], "DNS included"); // below the period

    // a new price in the catalog applies from the next period
    await plan(app, { id: light, name: "Hosting Light", price: 26000, currency: "CHF" });
    const [next] = await bill(app, { until: "2028-03-31" });
    assertEquals(Number((await lines(app, next))[0].price), 26000);
  });
});
