import { test } from "node:test";
import { assertStringIncludes } from "@std/assert";
import { App, Ctx, fs, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { cart } from "@qino/qino/shp3";

import { cms as buy } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

async function shop() {
  const app = new App({ db: "sqlite::memory:", dir: await fs.tempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("cron").add("locale.country").add("locale.currency");
  app.modules.add(import.meta.resolve("../../shp3/plugin.ts"), "shp3");
  await app.init();
  await app.db.table("page").insert({ id: 10, name: "Cup", access: 1 });
  await app.db.table("shp3_product").insert({ id: 10, price: 12, weight: 0.5 });
  return app;
}

test("buy1: a success page that is gone leads nowhere instead of to a 404", async () => {
  await using app = await shop();
  const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
  ctx.sess = await app.sessions.load();
  await requestStorage.run(ctx, async () => {
    await (await cart(ctx))!.itemAdd(10, 1);
    const page = await cms(app).node(10);
    const render = (success_page: number) => buy.node.render({
      app, cms: cms(app), page: () => Promise.resolve(page),
      settings: { success_page: () => success_page, back_page: () => undefined },
    } as unknown as Node, { ctx } as never).then(String);
    assertStringIncludes(await render(999), 'data-success=""');
    assertStringIncludes(await render(10), `data-success="${await page.url()}"`);
  });
});
