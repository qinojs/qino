import { assertEquals, assertRejects } from "@std/assert";
import { Db } from "@qino/qino";
import { create } from "@qino/qino/fin.payment";
import { paymentDbSchema } from "@qino/qino/tests";

import dbSchema from "../dbschema.json" with { type: "json" };
import { assign, ingest, paid } from "../mod.ts";

import type { App, Row } from "@qino/qino";
import type { Provider } from "@qino/qino/fin.payment";

/** A provider settled by the bank, as a QR bill is: its reference is the payment's external id. */
function byBank(app: () => App): Provider {
  return {
    name: "qr",
    label: "QR",
    methods: () => [{ name: "", label: "QR" }],
    start: (_app, payment) => Promise.resolve({ redirect: "", externalId: `REF${payment.id}` }),
    sync: async (_app, payment) => {
      const arrived = await paid(app(), Number(payment.id));
      return arrived ? { status: "paid", paid: arrived } : {};
    },
  };
}

async function setup() {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...paymentDbSchema.properties, ...dbSchema.properties } });
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  await db.loadTables();
  const events: Row[] = [];
  const app: App = {
    db,
    url: () => Promise.resolve("https://site.test/"),
    settings: { core: { _secret: "test" } },
    modules: { linked: () => [{ plugin: { paymentProvider: byBank(() => app) } }] },
    fire: (name: string, data: { payment: Row }) => (name === "payment:change" && events.push(data.payment), Promise.resolve(data)),
  } as unknown as App;
  return { app, events };
}

const statement = (transactions: { id: string; amount: number; reference?: string }[]) => ({
  iban: "CH56 0483 5012 3456 7800 9",
  currency: "CHF",
  transactions: transactions.map((tx) => ({ date: "2026-10-07", ...tx })),
});

Deno.test("lines are stored once per account; the account comes from the statement", async () => {
  const { app } = await setup();
  assertEquals(await ingest(app, statement([{ id: "a", amount: 100 }, { id: "b", amount: -50 }])), { added: 2, matched: 0 });
  assertEquals(await ingest(app, statement([{ id: "b", amount: -50 }, { id: "c", amount: 70 }])), { added: 1, matched: 0 });
  assertEquals(await app.db.col`SELECT iban FROM bank_account`, ["CH5604835012345678009"]);
  assertEquals(await app.db.col`SELECT amount FROM bank_tx ORDER BY id`, [100, -50, 70]);
});

Deno.test("a reference settles its payment; partial transfers add up", async () => {
  const { app, events } = await setup();
  const { id } = await create(app, { method: "qr", amount: 10000, currency: "CHF", ref: "fin.invoice:1", return: "/" });
  // spaces and case do not matter, the direction does
  const result = await ingest(app, statement([
    { id: "1", amount: 4000, reference: `ref ${id}` },
    { id: "2", amount: -4000, reference: `REF${id}` },
  ]));
  assertEquals(result, { added: 2, matched: 1 });
  assertEquals(await app.db.col`SELECT payment_id FROM bank_tx ORDER BY id`, [id, null]);
  assertEquals([events.at(-1)?.status, events.at(-1)?.paid], ["paid", 4000]);
  await ingest(app, statement([{ id: "3", amount: 6000, reference: `REF${id}` }]));
  assertEquals((await app.db.row`SELECT paid FROM payment WHERE id = ${id}`)?.paid, 10000);
  assertEquals(await paid(app, id), 10000);
});

Deno.test("a line nobody claimed is assigned by hand and becomes a recorded payment", async () => {
  const { app, events } = await setup();
  await ingest(app, statement([{ id: "x", amount: -12000 }]));
  const tx = Number(await app.db.one`SELECT id FROM bank_tx`);
  const payment = await assign(app, tx, "fin.invoice:9");
  const row = await app.db.row`SELECT * FROM payment WHERE id = ${payment}`;
  assertEquals([row?.direction, row?.provider, row?.amount, row?.ref, row?.status], ["out", "bank", 12000, "fin.invoice:9", "paid"]);
  assertEquals(events.at(-1)?.id, payment);
  assertEquals(Number(await app.db.one`SELECT payment_id FROM bank_tx WHERE id = ${tx}`), payment);
  await assertRejects(() => assign(app, tx, "fin.invoice:9"), Error, "already assigned");
});
