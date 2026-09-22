import { App, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cmsInstances } from "../lib/CMS.ts";

Deno.test("cms: plain() drops the markup and decodes entities", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    const node = await (await cms(app).node(1)).createChild();
    const ctx = await testContext({ app: { db: app.db, modules: app.modules } });
    cmsInstances.set(ctx.app, cms(app));
    ctx.lang = app.languages.def;
    await requestStorage.run(ctx, async () => {
      await node.text("subject", ctx.lang, "<p> Q&amp;A <b>today</b>&#33;&nbsp;</p>");
      assertEquals((await node.showText("subject")).plain(), "Q&A today!");
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
