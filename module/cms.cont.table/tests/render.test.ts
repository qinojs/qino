import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms.cont.table: the title is the caption, the first row can head the columns", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.table");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const page = await root.createChild({ access: 1, online_start: 0 });
    const table = await page.createCont({ module: "cms.cont.table", settings: { cols: 2, rows: 2, width_1: "40%" } });
    const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    const render = () => requestStorage.run(ctx, async () => String(await table.htmlRaw()));
    await requestStorage.run(ctx, async () => {
      for (const [name, value] of [["0_0", "Name"], ["0_1", "Price"], ["1_0", "Tea"], ["1_1", "3.50"]])
        await table.text(name, ctx.lang, value);
    });

    const plain = await render();
    assertEquals([plain.includes("<caption>"), plain.includes("<th")], [false, false], plain);

    await requestStorage.run(ctx, async () => {
      await table.title(ctx.lang, "Prices & more");
      await table.settings.header(true);
    });
    const headed = await render();
    assertEquals(headed.includes("<caption>Prices &amp; more</caption>"), true, headed);
    assertEquals(/<thead>\s*<tr>\s*<th scope=col style="width:40%">Name\s*<th scope=col>Price/.test(headed), true, headed);
    assertEquals(/<tbody>\s*<tr>\s*<td style="width:40%">Tea\s*<td>3.50/.test(headed), true, headed);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
