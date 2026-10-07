import { assertEquals, assertRejects } from "@std/assert";
import { Db, Output, Redirect, unixTime } from "@qino/qino";
import { testContext } from "@qino/qino/tests";

import dbSchema from "../dbschema.json" with { type: "json" };
import { create, methods, record, refund, sync } from "../mod.ts";
import { cron, init } from "../plugin.ts";

import type { App, Ctx, Row } from "@qino/qino";
import type { Provider, State } from "../mod.ts";

/** A provider that answers whatever the test puts in `next`. */
function fake() {
  const provider: Provider & { next: State; urls?: { back: string; notify: string; pay: string } } = {
    name: "fake",
    label: "Fake",
    next: {},
    methods: (_app, { currency }) =>
      currency === "CHF" ? [{ name: "card", label: "Card" }, { name: "twint", label: "TWINT" }] : [],
    start: (_app, payment, urls) => {
      provider.urls = urls;
      return Promise.resolve({ redirect: `https://pay.test/${payment.id}`, externalId: "tok" });
    },
    sync: () => Promise.resolve(provider.next),
    slip: (_app, payment) => Promise.resolve(`<p>Pay ${payment.amount} to us</p>`),
    refund: () => Promise.resolve({}),
  };
  return provider;
}

/** An app with a real database and the fake provider linked; `request` runs the route listener. */
async function setup() {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  await db.loadTables();
  db.schema = dbSchema;
  const provider = fake();
  const events: { payment: Row; previous?: string }[] = [];
  const handlers: Record<string, (e: { ctx: Ctx }) => Promise<void>> = {};
  const fakeApp = {
    db,
    url: () => Promise.resolve("https://site.test/"),
    modules: { linked: () => [{ plugin: { paymentProvider: provider } }] },
    // deno-lint-ignore no-explicit-any
    fire: (name: string, data: any) => (name === "payment:change" && events.push(data), Promise.resolve(data)),
    on: (name: string, fn: (e: { ctx: Ctx }) => Promise<void>) => void (handlers[name] = fn),
  };
  const context = (url = "https://site.test/") => testContext({ url, app: fakeApp });
  const app = (await context()).app as App;
  init(app, { signal: new AbortController().signal });
  // the listener ends a request by throwing its response; undefined means it let the request pass
  const request = async (url: string) =>
    handlers.route({ ctx: await context(url) }).then(() => undefined, (e) => e);
  return { app, provider, events, request };
}

const order = { amount: 4990, currency: "CHF", method: "fake.twint", ref: "shop.order:1", return: "/done" };

Deno.test("methods are listed per provider, as create() takes them", async () => {
  const { app } = await setup();
  const chf = await methods(app, { amount: 100, currency: "CHF" });
  assertEquals(chf.map((m) => m.method), ["fake.card", "fake.twint"]);
  assertEquals(await methods(app, { amount: 100, currency: "EUR" }), []);
});

Deno.test("a method without a name stands for the provider itself", async () => {
  const { app, provider } = await setup();
  provider.methods = () => [{ name: "", label: "Fake" }];
  assertEquals(await methods(app, { amount: 100, currency: "CHF" }), [{ method: "fake", label: "Fake" }]);
  const { id } = await create(app, { ...order, method: "fake" });
  assertEquals((await app.db.row`SELECT method FROM payment WHERE id = ${id}`)?.method, null);
});

Deno.test("the job asks after open payments with growing gaps, for two days", async () => {
  const { app, provider } = await setup();
  let asked = 0;
  provider.sync = () => (asked++, Promise.resolve({}));
  const { id } = await create(app, order);
  const at = async (created: number, changed: number) => {
    const now = unixTime();
    await app.db.exec`UPDATE payment SET created = ${now - created}, changed = ${now - changed} WHERE id = ${id}`;
    const before = asked;
    await cron.sync.run(app);
    return asked > before;
  };
  assertEquals(await at(60, 60), false); // just started, the payer is still at the provider
  assertEquals(await at(900, 900), true); // first ask after ten minutes
  assertEquals(await at(4000, 1000), false); // asked at 3000s of age: waits 3000s
  assertEquals(await at(7000, 4000), true);
  assertEquals(await at(3 * 86400, 86400), false); // too old
});

Deno.test("create stores an incoming payment and hands the provider signed addresses", async () => {
  const { app, provider } = await setup();
  const { id, redirect } = await create(app, order);
  assertEquals(provider.urls!.back.replace("/return/", "/pay/"), provider.urls!.pay);
  assertEquals(redirect, `https://pay.test/${id}`);
  const row = await app.db.row`SELECT * FROM payment WHERE id = ${id}`;
  assertEquals(
    [row?.direction, row?.status, row?.method, row?.external_id, row?.return_url],
    ["in", "pending", "twint", "tok", "https://site.test/done"],
  );
  assertEquals(provider.urls!.back.replace("/return/", "/notify/"), provider.urls!.notify);
});

Deno.test("create rejects amounts that are not minor units and unknown providers", async () => {
  const { app } = await setup();
  for (const amount of [0, -1, 49.9]) await assertRejects(() => create(app, { ...order, amount }));
  await assertRejects(() => create(app, { ...order, currency: "chf" }));
  await assertRejects(() => create(app, { ...order, method: "missing.card" }));
  assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM payment`), 0);
});

Deno.test("a status change fires once, however often it is reported", async () => {
  const { app, provider, events } = await setup();
  const { id } = await create(app, order);
  provider.next = { status: "paid", paid: 4990, method: "card", fee: 120 };
  await Promise.all([sync(app, id), sync(app, id)]);
  await sync(app, id);
  assertEquals(
    events.map((e) => [e.payment.status, e.payment.method, e.payment.fee, e.previous]),
    [["paid", "card", 120, "pending"]],
  );
});

Deno.test("a recorded payment fires the event and is left alone by sync", async () => {
  const { app, events } = await setup();
  const id = await record(app, { direction: "out", provider: "cash", amount: 2000, currency: "EUR", ref: "x:1" });
  assertEquals(
    events.map((e) => [e.payment.direction, e.payment.status, e.payment.paid, e.previous]),
    [["out", "paid", 2000, undefined]],
  );
  assertEquals((await sync(app, id))?.status, "paid");
  await assertRejects(() => refund(app, id), Error, "cannot refund");
});

Deno.test("refund defaults to what is left and refuses more", async () => {
  const { app, provider, events } = await setup();
  const { id } = await create(app, order);
  await assertRejects(() => refund(app, id)); // nothing paid yet
  provider.next = { status: "paid", paid: 4990 };
  await sync(app, id);
  await assertRejects(() => refund(app, id, 5000));
  assertEquals((await refund(app, id, 990))?.status, "paid"); // partial
  const row = await refund(app, id);
  assertEquals([row?.status, row?.refunded], ["refunded", 4990]);
  assertEquals(events.at(-1)?.previous, "paid");
});

Deno.test("the payer comes back to the return url, the provider gets an ok, a forged token nothing", async () => {
  const { app, provider, events, request } = await setup();
  const { id } = await create(app, order);
  provider.next = { status: "paid", paid: 4990 };
  const back = await request(provider.urls!.back);
  assertEquals(back instanceof Redirect && back.buildHeaders().get("location"), "https://site.test/done");
  assertEquals(events.map((e) => e.payment.status), ["paid"]);
  const notify = await request(provider.urls!.notify);
  assertEquals(notify instanceof Output && notify.body, "ok");
  const forged = await request(provider.urls!.back.replace(`/${id}-`, `/${id + 1}-`));
  assertEquals(forged instanceof Output && forged.status, 404);
  assertEquals(await request("https://site.test/payment/other/x"), undefined);
});

Deno.test("the slip of an open payment is shown at its pay address, a settled one has none", async () => {
  const { app, provider, request } = await setup();
  await create(app, order);
  const shown = await request(provider.urls!.pay);
  assertEquals(shown instanceof Output && shown.status, 200);
  assertEquals(String(shown.body).endsWith("<p>Pay 4990 to us</p>"), true);
  provider.next = { status: "paid", paid: 4990 };
  await request(provider.urls!.notify);
  assertEquals((await request(provider.urls!.pay)).status, 404);
});

Deno.test("money that moves without a new status is a change too", async () => {
  const { app, provider, events } = await setup();
  const { id } = await create(app, order);
  provider.next = { status: "processing", paid: 2000 };
  await sync(app, id);
  provider.next = { status: "processing", paid: 3000 };
  await sync(app, id);
  await sync(app, id);
  assertEquals(events.map((e) => [e.payment.status, e.payment.paid, e.previous]), [
    ["processing", 2000, "pending"],
    ["processing", 3000, "processing"],
  ]);
});
