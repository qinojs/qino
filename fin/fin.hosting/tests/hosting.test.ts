import { assertEquals, assertRejects } from "@std/assert";
import { create, issue } from "@qino/qino/fin.invoice";
import { cancel, plan, subscribe, update } from "@qino/qino/fin.subscription";

import { withFinApp } from "../../tests/app.ts";
import { adopt, billable, OURS, removeSource, saveSource, sources, blockers, domains, get, kindOf, link, normalize, open, parseRef, prune, refOf, remove, save, subscriptionsBy, sync, unlink } from "../mod.ts";

import type { App } from "@qino/qino";

const FIN = ["fin.payment", "fin.invoice", "fin.subscription", "fin.hosting"];

const customer = async (app: App, name: string) =>
  Number(await app.db.table("usr").insert({ active: 1, pw: "", superuser: 0, given_name: name, family_name: "Muster" }));

const planOf = (app: App, name: string) => plan(app, { name, price: 2500, currency: "CHF", unit: "year" });

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
    // each alias right after its domain, before its subdomains
    await save(app, "shop.example.ch", { usrId: anna });
    await save(app, "example-ch.net", { aliasOf: "example.ch" });
    assertEquals((await domains(app, anna)).map((d) => d.name), ["aaa.ch", "example.ch", "example.com", "example-ch.net", "shop.example.ch"]);
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
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${named}`, refOf("neu.ch", "hosting"));
    // a plan's subscription: its name is the detail, the plan's tells what for
    const plan = await planOf(app, "Domain .ch");
    const detail = Number(await subscribe(app, { usrId: anna, planId: plan, name: "plan.ch", start: "2026-01-01" }));
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${detail}`, refOf("plan.ch", "domain"));
    // a service: neither
    const service = await hosting(app, anna, "Service neu.ch");
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${service}`, refOf("neu.ch"));
    // another customer's domain is not taken; no domain in the name, nothing happens
    const foreign = await hosting(app, ben, "Domain neu.ch");
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${foreign}`, null);
    assertEquals(await adopt(app, { id: 0, usr_id: anna, name: "Service", ref: null }), undefined);
    assertEquals(await adopt(app, { id: named, usr_id: anna, name: "Hosting x.ch", ref: "shop.order:1" }), undefined);
    // renamed after a domain later: linked then
    const later = await hosting(app, ben, "Hosting");
    await update(app, later, { name: "Hosting ben.ch" });
    assertEquals(await app.db.one`SELECT ref FROM subscription WHERE id = ${later}`, refOf("ben.ch", "hosting"));
  });
});

Deno.test("fin.hosting: a ref names the domain and what it pays for", () => {
  assertEquals(parseRef(refOf("example.ch", "hosting")), { name: "example.ch", kind: "hosting" });
  assertEquals(parseRef(refOf("example.ch")), { name: "example.ch", kind: undefined });
  assertEquals([parseRef("fin.invoice:7"), parseRef("fin.hosting:"), parseRef("fin.hosting:x.ch/other")], [undefined, undefined, undefined]);
  assertEquals(kindOf({ ref: refOf("example.ch", "domain") }), "domain");
});

Deno.test("fin.hosting: registration and hosting are billed apart, ours not at all; an alias has no hosting", async () => {
  await withFinApp(FIN, async (app) => {
    const anna = await customer(app, "Anna");
    await save(app, "both.ch", { usrId: anna, registrar: "infomaniak", host: "plesk:s3" });
    await save(app, "hosted.ch", { usrId: anna, host: "plesk:s3" }); // the customer registered it
    await save(app, "ours.ch", { usrId: OURS, registrar: "infomaniak", host: "plesk:s3" });
    assertEquals([billable(await get(app, "both.ch") ?? {}), billable(await get(app, "ours.ch") ?? {})], [["domain", "hosting"], []]);
    await assertRejects(async () => link(app, "ours.ch", await hosting(app, anna), "hosting"), Error, "is ours");
    await link(app, "both.ch", await hosting(app, anna, "Webspace"), "hosting");
    const todo = async () => (await open(app)).map((o) => [o.domain.name, o.missing, o.kind]);
    assertEquals(await todo(), [["both.ch", "billed", "domain"], ["hosted.ch", "billed", "hosting"]]);
    await link(app, "both.ch", await hosting(app, anna, "Registration"), "domain");
    await link(app, "hosted.ch", await hosting(app, anna, "Service")); // anything else bills no hosting
    assertEquals(await todo(), [["hosted.ch", "billed", "hosting"]]);

    await assertRejects(() => save(app, "alias.ch", { aliasOf: "both.ch", host: "plesk:s3" }), Error, "an alias is not");
    await save(app, "alias.ch", { aliasOf: "both.ch" });
    const webspace = await hosting(app, anna);
    await assertRejects(() => link(app, "alias.ch", webspace, "hosting"), Error, "is an alias, it has no hosting");
  });
});

Deno.test("fin.hosting: the registrars say which domains are ours to register; what is open stands out", async () => {
  await withFinApp(FIN, async (app) => {
    const anna = await customer(app, "Anna");
    await save(app, "theirs.ch", { usrId: anna }); // the customer keeps it elsewhere: nothing to bill
    await save(app, "moved.ch", { usrId: anna, registrar: "test" });
    let list = [{ name: "Example.CH", expires: "2027-03-01" }, { name: "ours.ch" }, { name: "anna.ch" }];
    const registrar = { name: "test", domains: () => Promise.resolve(list) };
    assertEquals(await sync(app, { registrars: [registrar] }), [{ name: "test", found: 3, added: 3, gone: 1 }]);
    assertEquals((await get(app, "example.ch"))?.expires, "2027-03-01");
    assertEquals((await get(app, "moved.ch"))?.registrar, null); // gone from there: no longer ours to bill
    await save(app, "ours.ch", { usrId: OURS });
    await link(app, "anna.ch", await hosting(app, anna, "Domain"), "domain");
    // registered by us, not ours: example.ch has no customer; theirs, moved, ours and the billed anna.ch are fine
    assertEquals((await open(app)).map((o) => [o.domain.name, o.missing]), [["example.ch", "customer"]]);
    await save(app, "example.ch", { usrId: anna });
    assertEquals((await open(app)).map((o) => [o.domain.name, o.missing, o.kind]), [["example.ch", "billed", "domain"]]);

    // a registrar that fails changes nothing
    list = [];
    const failing = { name: "test", domains: () => Promise.reject(new Error("down")) };
    assertEquals(await sync(app, { registrars: [failing] }), [{ name: "test", found: 0, added: 0, gone: 0, error: "down" }]);
    assertEquals((await get(app, "example.ch"))?.registrar, "test");
  });
});

Deno.test("fin.hosting: a host's domains are hosted, with the aliases it lists; what it no longer lists is not", async () => {
  await withFinApp(FIN, async (app) => {
    const anna = await customer(app, "Anna");
    await save(app, "example.ch", { usrId: anna, registrar: "infomaniak" });
    await save(app, "own.ch", { aliasOf: "example.ch" }); // an alias the host does not list
    await save(app, "was.ch");
    await save(app, "alias.ch", { aliasOf: "was.ch" }); // a hosted domain is no alias: it becomes one of example.ch
    await save(app, "gone.ch", { host: "plesk:s3" });
    let list: { name: string; aliases?: string[] }[] = [
      { name: "example.ch", aliases: ["alias.ch", "new-alias.ch", "not a domain"] },
      { name: "shop.example.ch" },
      { name: "was.ch" },
    ];
    const host = { name: "plesk:s3", domains: () => Promise.resolve(list) };
    assertEquals(await sync(app, { hosts: [host] }), [{ name: "plesk:s3", found: 3, added: 2, gone: 1 }]);
    const d = async (name: string) => [(await get(app, name))?.host ?? null, (await get(app, name))?.alias_of ?? null];
    assertEquals(await d("example.ch"), ["plesk:s3", null]);
    assertEquals((await get(app, "example.ch"))?.registrar, "infomaniak"); // where it is registered stays
    assertEquals(await d("shop.example.ch"), ["plesk:s3", null]);
    assertEquals(await d("alias.ch"), [null, "example.ch"]);
    assertEquals(await d("new-alias.ch"), [null, "example.ch"]);
    assertEquals((await get(app, "new-alias.ch"))?.usr_id, anna); // its domain's customer's
    assertEquals(await d("own.ch"), [null, null]); // the host knows example.ch's aliases
    assertEquals(await d("gone.ch"), [null, null]);

    // what cannot be taken over is reported, the rest is
    await save(app, "solo.ch");
    await save(app, "sub.solo.ch", { aliasOf: "solo.ch" });
    list = [{ name: "example.ch", aliases: ["solo.ch"] }];
    const [report] = await sync(app, { hosts: [host] });
    assertEquals(report.failed, ["solo.ch: solo.ch has aliases of its own"]);
    assertEquals(await d("shop.example.ch"), [null, null]);
  });
});

Deno.test("fin.hosting: a synced domain is held; prune removes what nothing links to", async () => {
  await withFinApp([...FIN, "fin.hosting.infomaniak", "fin.hosting.plesk"], async (app) => {
    const anna = await customer(app, "Anna");
    await saveSource(app, { name: "infomaniak", type: "infomaniak", secret: "t0k" });
    await saveSource(app, { name: "s3", type: "plesk", url: "https://s3.example.com:8443", secret: "k3y" });
    await save(app, "synced.ch", { registrar: "infomaniak" });
    await save(app, "served.ch", { host: "s3" });
    assertEquals([await blockers(app, "synced.ch"), await blockers(app, "served.ch")], [["synced"], ["synced"]]);
    await save(app, "main.ch");
    await save(app, "alias.ch", { aliasOf: "main.ch" });
    await save(app, "billed.ch", { usrId: anna });
    const sub = await hosting(app, anna);
    await link(app, "billed.ch", sub);
    await save(app, "ended.ch", { usrId: anna });
    const ended = await hosting(app, anna);
    await link(app, "ended.ch", ended);
    await cancel(app, ended);
    await save(app, "lost.ch", { usrId: anna, registrar: "Hostpoint" }); // kept by hand: not synced
    await save(app, "elsewhere.ch", { host: "old" }); // hosted, by hand
    await save(app, "lone.ch");
    assertEquals(await prune(app), ["lone.ch", "lost.ch"]);
    assertEquals((await domains(app)).map((d) => d.name), ["billed.ch", "elsewhere.ch", "ended.ch", "main.ch", "alias.ch", "served.ch", "synced.ch"]);
  });
});

Deno.test("fin.hosting: a subdomain is its parent's owner's, by default", async () => {
  await withFinApp(FIN, async (app) => {
    const [anna, ben] = [await customer(app, "Anna"), await customer(app, "Ben")];
    await save(app, "example.ch", { usrId: anna });
    await save(app, "shop.example.ch");
    await save(app, "a.b.example.ch"); // the nearest parent there is
    await save(app, "other.example.ch", { usrId: ben }); // given: stays
    const owner = async (name: string) => (await get(app, name))?.usr_id ?? null;
    assertEquals([await owner("shop.example.ch"), await owner("a.b.example.ch"), await owner("other.example.ch")], [anna, anna, ben]);

    // one without owner becomes the parent's as it gets one, with its aliases
    await save(app, "late.ch");
    await save(app, "www.late.ch");
    await save(app, "late-alias.ch", { aliasOf: "www.late.ch" });
    await save(app, "late.ch", { usrId: OURS });
    assertEquals([await owner("www.late.ch"), await owner("late-alias.ch")], [OURS, OURS]);
    await save(app, "notlate.ch"); // no subdomain of late.ch
    assertEquals(await owner("notlate.ch"), null);
  });
});

Deno.test("fin.hosting: sources are kept by name, of a type a module brings; a secret is kept unless given", async () => {
  await withFinApp([...FIN, "fin.hosting.plesk"], async (app) => {
    await assertRejects(() => saveSource(app, { name: "x", type: "nowhere" }), Error, "no source type nowhere");
    await assertRejects(() => saveSource(app, { name: " ", type: "plesk" }), Error, "needs a name");
    await saveSource(app, { name: "s3", type: "plesk", url: "https://s3.example.com:8443", user: "admin", secret: "pw" });
    await saveSource(app, { name: "s3", type: "plesk", url: "https://s3.example.com:8443", user: "root", secret: "" });
    assertEquals((await sources(app)).map((s) => [s.name, s.user, s.secret]), [["s3", "root", "pw"]]);
    await removeSource(app, "s3");
    assertEquals(await sources(app), []);
  });
});
