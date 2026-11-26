import { test } from "node:test";
import { App, fs, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import { searchNodes } from "../api-exports.ts";

test("cms: searchNodes finds by title and cmspid, deduplicates languages, renders breadcrumbs", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    const root = await cms(app).node(1);
    await (await root.title()).lang("en").set("Home");
    const sub = await root.createChild({ access: 1 });
    await (await sub.title()).lang("en").set("About Us");
    await (await sub.title()).lang("de").set("About Us DE");
    const leaf = await sub.createChild({ access: 1 });
    await (await leaf.title()).lang("en").set("Team");

    const ctx = await testContext({ app, set: { lang: "en" } });
    await requestStorage.run(ctx, async () => {
      const byText = await searchNodes("about");
      assertEquals(byText.map((r) => r.value), [sub.id]);
      assertStringIncludes(byText[0].html, "<b>About Us</b>");
      assertStringIncludes(byText[0].html, "Home");

      const byId = await searchNodes(`cmspid://${leaf.id}`);
      assertEquals(byId[0].value, leaf.id);
      assertStringIncludes(byId[0].html, "About Us");
      assertStringIncludes(byId[0].html, "Home");

      const empty = await searchNodes("");
      assertEquals(empty.length >= 3, true);
    });
  } finally {
    await new Promise((r) => setTimeout(r, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
