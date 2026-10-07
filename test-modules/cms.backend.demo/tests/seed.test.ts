import { App, sql } from "@qino/qino";
import { assert, assertEquals, fakeT } from "@qino/qino/tests";

import { reset, wipe } from "../mod.ts";
import { render, status } from "../render.ts";
import { seeders } from "../lib/seeders.ts";

/** Row count per table — the whole database in one object. */
async function census(app: App): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(app.db.tables)) out[name] = Number(await app.db.one`SELECT COUNT(*) FROM ${sql.id(name)}` ?? 0);
  return out;
}

async function demoApp(): Promise<App> {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("cms.installation.default");
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.backend.demo");
  await app.init();
  return app;
}

Deno.test("cms.backend.demo: seeds, and a wipe leaves the installation exactly as it was", async () => {
  const app = await demoApp();
  try {
    const before = await census(app);

    const seed = await reset(app, { scale: 0.3 });
    assert(seed.counts.pages > 10, `pages: ${seed.counts.pages}`);
    assert(seed.counts.users > 5, `users: ${seed.counts.users}`);
    assert(seed.counts.groups > 5, `groups: ${seed.counts.groups}`);
    assert(seed.counts.visits > 10, `visits: ${seed.counts.visits}`);

    const seeded = await census(app);
    for (const table of ["page", "page_text", "text", "usr", "grp", "usr_grp", "log", "file"]) {
      assert(seeded[table] > before[table], `${table}: ${before[table]} → ${seeded[table]}`);
    }

    await wipe(app);
    const after = await census(app);
    // dictionaries and settings are shared: a run may add a value, but never owns one
    for (const shared of ["log_url", "log_ip", "log_user_agent", "qg_setting"]) delete after[shared], delete before[shared];
    assertEquals(after, before);
  } finally {
    await app.db.close();
  }
});

Deno.test("cms.backend.demo: the same seed builds the same site twice", async () => {
  const app = await demoApp();
  try {
    const titles = async () => (await app.db.query`SELECT text FROM text_lang ORDER BY text`).map((row) => row.text).join("|");
    await reset(app, { scale: 0.3, only: ["pages"] });
    const first = await titles();
    await reset(app, { scale: 0.3, only: ["pages"] });
    assertEquals(await titles(), first);
  } finally {
    await app.db.close();
  }
});

Deno.test("cms.backend.demo: the panel lists the seeders and what the last run wrote", async () => {
  const app = await demoApp();
  try {
    app.t = fakeT;
    const node = { app } as never;
    const empty = String(await render(node));
    for (const seeder of seeders) assert(empty.includes(`>${seeder.name}<`), `missing ${seeder.name}`);
    assert(empty.includes("No demo data"));

    await reset(app, { scale: 0.3, only: ["groups", "users"] });
    const filled = String(await status(node));
    assert(filled.includes("40 users") || filled.includes("12 users"), filled);
    assert(filled.includes("rows in the ledger"), filled);
  } finally {
    await app.db.close();
  }
});

Deno.test("cms.backend.demo: finance — invoices in every state, a statement, and a wipe leaves nothing", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("cms.installation.default");
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.backend.demo");
  app.stores.add(import.meta.resolve("../../../fin/store.json"))
    .add("fin.invoice").add("fin.bank").add("fin.payment.qrbill").add("fin.accounting.ch");
  await app.init();
  try {
    await app.settings["fin.payment.qrbill"].iban("CH44 3199 9123 0008 8901 2");
    await app.settings.core.url("https://demo.test/");
    const before = await census(app);
    const seed = await reset(app, { only: ["users", "fin"] });
    assert(seed.counts.invoices > 20, `invoices: ${seed.counts.invoices}`);
    assert(seed.counts["bank lines"] > 3, `bank lines: ${seed.counts["bank lines"]}`);
    const states = await app.db.col`SELECT DISTINCT status FROM invoice ORDER BY status`;
    assertEquals(states, ["canceled", "draft", "open", "paid"]);
    assert(Number(await app.db.one`SELECT COUNT(*) FROM bank_tx WHERE payment_id IS NULL`) > 0, "something to assign");
    assert(Number(await app.db.one`SELECT COUNT(*) FROM bank_tx WHERE payment_id IS NOT NULL`) > 0, "QR bills settled");
    assert(seed.counts.entries > 0, "entries by hand");
    assert(Number(await app.db.one`SELECT COUNT(*) FROM entry WHERE ref LIKE 'fin.invoice:%'`) > 10, "invoices booked themselves");

    await wipe(app);
    const after = await census(app);
    for (const shared of ["log_url", "log_ip", "log_user_agent", "qg_setting"]) delete after[shared], delete before[shared];
    assertEquals(after, before);
  } finally {
    await app.db.close();
  }
});
