import { test } from "node:test";
import { App, fs, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, testContext } from "@qino/qino/tests";

test("cms: a language added since the last start gets its addresses", async () => {
  const dir = await fs.tempDir() + "/";
  const boot = async () => {
    const app = new App({ db: `sqlite:${dir}site.sqlite`, dir });
    app.stores.add(import.meta.resolve("../../store.json")).add("cms");
    await app.init();
    return app;
  };
  const stop = async (app: App) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
  };
  try {
    let app = await boot();
    await app.settings.core.langs("en");
    const id = (await (await cms(app).node(1)).createChild()).id;
    await (await cms(app).node(id)).title("en", "alpha");
    await stop(app);

    app = await boot();
    await app.settings.core.langs("en,de");
    await stop(app);

    app = await boot();
    assertEquals(await (await cms(app).node(id)).urlSeo("de"), "de/alpha");
    await stop(app);
  } finally {
    await fs.remove(dir, { recursive: true });
  }
});

test("cms: an empty stored address is the site root, not a missing one", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    await app.settings.core.langs("de");
    const node = await cms(app).node((await (await cms(app).node(1)).createChild()).id);
    await app.db.table("page_url").insert({ page_id: node.id, lang: "de", url: "", custom: 1 }); // the home page, as PHP stored it
    const ctx = await testContext({ app });
    ctx.lang = "de";
    assertEquals(await requestStorage.run(ctx, () => node.url("de")), ctx.req.appUrl);
  } finally {
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
