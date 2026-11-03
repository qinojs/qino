import { test } from "node:test";
import { App, Ctx, fs, requestStorage, runAs, unixTime } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";


test("form: a visitor judged spam is told and keeps the input, a sure bot gets the confirmation", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.form");
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    const usr = Number(await app.db.table("usr").insert({ username: "su@example.test", active: 1, superuser: 1 }));
    const form = await (await (await cms(app).node(1)).createChild()).cont("main", "cms.cont.form");
    await runAs(app, usr, "test", async () => {
      await form.html(); // creates its field block
      await (await form.cont("main")).settings.fields.name({});
    });
    const client = Number(await app.db.table("client").insert({}));
    await app.db.table("log").insert({ client_id: client, time: unixTime() });
    const send = async (vars: Record<string, string>) => {
      const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
      ctx.sess = await app.sessions.load();
      ctx.lang = app.languages.def;
      await ctx.initSettings();
      ctx.clientId = String(client);
      return requestStorage.run(ctx, async () => String(await form.html(vars)));
    };
    const told = await send({ name: "Ada", your_name: "" });
    assertEquals(told.includes("could not be sent"), true);
    assertEquals(told.includes('value="Ada"'), true);
    const bot = await send({ name: "Bot", your_name: "x" });
    assertEquals(bot.includes("could not be sent") || bot.includes("<form"), false);
    assertEquals((await app.db.col`SELECT data FROM form_entry ORDER BY id`).length, 2, "both are kept");
  } finally {
    await new Promise((r) => setTimeout(r, 100)); // the requests' background writes
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});

test("form: what the form sends beside its fields is kept, within bounds; spam is marked", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.form");
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    const usr = Number(await app.db.table("usr").insert({ username: "su@example.test", active: 1, superuser: 1 }));
    const form = await (await (await cms(app).node(1)).createChild()).cont("main", "cms.cont.form");
    const entries = async () => (await app.db.col`SELECT data FROM form_entry ORDER BY id`).map((d) => JSON.parse(String(d)));
    await runAs(app, usr, "test", async () => {
      await form.html(); // creates its field block
      await (await form.cont("main")).settings.fields.name({});
      await app.db.exec`UPDATE log SET time = 0`; // a client seen long ago: no bot
      await form.html({ name: "Ada", phone: "079", topics: ["a", "b"], empty: "", your_name: "" });
      const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => ["f" + i, "x"]));
      await form.html({ name: "Bob", ...many });
      await form.html({ name: "Cy", note: "x".repeat(100_001) });
      await form.html({ name: "Bot", your_name: "x" });
    });
    assertEquals(await entries(), [{ name: "Ada", phone: "079", topics: ["a", "b"] }, { name: "Bot" }], "more than 100 others or 100,000 characters are refused");
    assertEquals((await app.db.col`SELECT spam FROM form_entry ORDER BY id`).map(Number), [0, 1], "a filled honeypot is kept as spam");
  } finally {
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
