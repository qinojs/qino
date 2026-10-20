import { assertEquals, assertRejects } from "@std/assert";
import { create, issue } from "@qino/qino/fin.invoice";
import { cancel, subscribe } from "@qino/qino/fin.subscription";

import { withFinApp } from "../../tests/app.ts";
import { blockers, domains, get, link, normalize, refOf, remove, save, subscriptionsBy, unlink } from "../mod.ts";

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
    await unlink(app, own);
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
