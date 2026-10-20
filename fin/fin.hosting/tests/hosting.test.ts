import { assertEquals, assertRejects } from "@std/assert";
import { create, issue } from "@qino/qino/fin.invoice";
import { cancel, subscribe, update } from "@qino/qino/fin.subscription";

import { withFinApp } from "../../tests/app.ts";
import { adopt, blockers, domains, get, link, normalize, refOf, remove, save, subscriptionsBy, unlink } from "../mod.ts";

import type { App } from "@qino/qino";

const FIN = ["fin.payment", "fin.invoice", "fin.subscription", "fin.hosting"];

const customer = async (app: App, name: string) =>
  Number(await app.db.table("usr").insert({ active: 1, pw: "", superuser: 0, given_name: name, family_name: "Muster" }));

const hosting = (app: App, usrId: number, name = "Hosting") =>
  subscribe(app, { usrId, name, price: 24000, currency: "CHF", start: "2026-01-01" });

Deno.test("fin.hosting: a domain is stored lower case, as punycode, without scheme, path or trailing dot", () => {
  assertEquals(normalize("Example.CH."), "example.ch");
  assertEquals(normalize("https://www.example.ch/de/home?x=1"), "www.example.ch");
  assertEquals(normalize("müller.ch"), "xn--mller-kva.ch");
  for (const bad of ["", "localhost", "example", "a b.ch", "mailto:x@y.ch", "1.2.3.4"]) assertEquals(normalize(bad), "", bad);
});

Deno.test("fin.hosting: domains with owner, registrar and aliases one level deep", async () => {
  await withFinApp(FIN, async (app) => {
    const anna = await customer(app, "Anna");
    assertEquals(await save(app, "Example.ch", { usrId: anna, registrar: " Hostpoint " }), "example.ch");
    await save(app, "example.com", { aliasOf: "example.ch" });
    await save(app, "aaa.ch", { usrId: anna });
    // the alias took the owner over; changing one field keeps the others
    assertEquals((await get(app, "example.com"))?.usr_id, anna);
    await save(app, "example.ch", { registrar: "Infomaniak" });
    assertEquals((await get(app, "example.ch"))?.usr_id, anna);
    // each alias right after its domain
    assertEquals((await domains(app, anna)).map((d) => d.name), ["aaa.ch", "example.ch", "example.com"]);
    assertEquals(await domains(app, anna + 1), []);

    await assertRejects(() => save(app, "x.ch", { aliasOf: "example.com" }), Error, "is an alias itself");
    await assertRejects(() => save(app, "example.ch", { aliasOf: "aaa.ch" }), Error, "has aliases of its own");
    await assertRejects(() => save(app, "example.ch", { aliasOf: "example.ch" }), Error, "no alias of itself");
    await assertRejects(() => save(app, "y.ch", { aliasOf: "nowhere.ch" }), Error, "no domain nowhere.ch");
    await assertRejects(() => save(app, "not a domain"), Error, "not a domain");
  });
});

Deno.test("fin.hosting: subscriptions are linked by ref, only the owner's, and grouped by domain", async () => {
  await withFinApp(FIN, async (app) => {
    const [anna, ben] = [await customer(app, "Anna"), await customer(app, "Ben")];
    await save(app, "example.ch", { usrId: anna });
    const [own, other] = [await hosting(app, anna), await hosting(app, ben)];
    await link(app, "example.ch", own);
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${own}`, refOf("example.ch"));
    await assertRejects(() => link(app, "example.ch", other), Error, "another customer's");
    assertEquals([...(await subscriptionsBy(app, anna)).entries()].map(([d, subs]) => [d, subs.map((s) => Number(s.id))]), [["example.ch", [own]]]);
    await assertRejects(() => unlink(app, "other.ch", own), Error, "is not for other.ch");
    await unlink(app, "example.ch", own);
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${own}`, null);
  });
});

Deno.test("fin.hosting: a domain is held by aliases, running subscriptions and unpaid invoices", async () => {
  await withFinApp(FIN, async (app) => {
    const anna = await customer(app, "Anna");
    await save(app, "example.ch", { usrId: anna });
    await save(app, "example.com", { aliasOf: "example.ch" });
    const sub = await hosting(app, anna);
    await link(app, "example.ch", sub);
    assertEquals(await blockers(app, "example.ch"), ["aliases", "running"]);
    await assertRejects(() => remove(app, "example.ch"), Error, "is held: aliases, running");

    await remove(app, "example.com"); // an alias holds nothing
    // billed but unpaid: ended, it still holds the domain
    const invoice = Number((await issue(app, await create(app, { currency: "CHF", usrId: anna, lines: [{ name: "Hosting", price: 24000 }] })))?.id);
    await app.db.table("subscription_invoice").insert({ subscription_id: sub, period_start: "2026-01-01", period_end: "2026-12-31", invoice_id: invoice });
    await cancel(app, sub);
    assertEquals(await blockers(app, "example.ch"), ["unpaid"]);
    await app.db.exec`UPDATE invoice SET status = 'paid' WHERE id = ${invoice}`;
    assertEquals(await blockers(app, "example.ch"), []);
    await remove(app, "example.ch");
    assertEquals(await get(app, "example.ch"), undefined);
    // what the ended subscription was for stays readable
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${sub}`, refOf("example.ch"));
  });
});

Deno.test("fin.hosting: an alias is its domain's customer's, may cost on its own, and bills never point at the wrong customer", async () => {
  await withFinApp(FIN, async (app) => {
    const [anna, ben] = [await customer(app, "Anna"), await customer(app, "Ben")];
    await save(app, "example.ch", { usrId: anna });
    await save(app, "example.com", { aliasOf: "example.ch", usrId: ben }); // its own owner does not count
    assertEquals((await get(app, "example.com"))?.usr_id, anna);
    await save(app, "example.ch", { usrId: ben }); // nothing billed yet: it may change hands, its alias with it
    assertEquals((await get(app, "example.com"))?.usr_id, ben);

    const sub = await hosting(app, ben);
    await link(app, "example.ch", sub);
    await link(app, "example.com", await hosting(app, ben, "Domain")); // the alias's registration costs
    await assertRejects(() => save(app, "example.ch", { usrId: anna }), Error, "subscriptions of its owner still run");
    // a domain becomes an alias with its own subscription still on it
    await save(app, "solo.ch", { usrId: ben });
    const soloSub = await hosting(app, ben, "Domain");
    await link(app, "solo.ch", soloSub);
    await save(app, "solo.ch", { aliasOf: "example.ch" });
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${soloSub}`, refOf("solo.ch"));

    // a domain without an owner becomes the subscription's customer's
    await save(app, "free.ch");
    await link(app, "free.ch", await hosting(app, anna));
    assertEquals((await get(app, "free.ch"))?.usr_id, anna);
  });
});

Deno.test("fin.hosting: a subscription named after a domain is for it — domain added and linked, as it is saved", async () => {
  await withFinApp(FIN, async (app) => {
    const [anna, ben] = [await customer(app, "Anna"), await customer(app, "Ben")];
    const named = await hosting(app, anna, "Hosting Neu.CH"); // subscribe fires subscription:save
    assertEquals((await get(app, "neu.ch"))?.usr_id, anna);
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${named}`, refOf("neu.ch"));
    // a plan's subscription: its name is the detail
    const detail = await hosting(app, anna, "plan.ch");
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${detail}`, refOf("plan.ch"));
    // another customer's domain is not taken; no domain in the name, nothing happens
    const foreign = await hosting(app, ben, "Domain neu.ch");
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${foreign}`, null);
    assertEquals(await adopt(app, { id: 0, usr_id: anna, name: "Service", ref: null }), undefined);
    assertEquals(await adopt(app, { id: named, usr_id: anna, name: "Hosting x.ch", ref: "shop.order:1" }), undefined);
    // renamed after a domain later: linked then
    const later = await hosting(app, ben, "Hosting");
    await update(app, later, { name: "Hosting ben.ch" });
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${later}`, refOf("ben.ch"));
  });
});
