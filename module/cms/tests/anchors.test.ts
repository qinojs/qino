import { test } from "node:test";
import { App, fs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

test("cms: a content's anchor is computed, not stored; a named one is, until it is taken back", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    const page = await (await cms(app).node(1)).createChild();
    await page.title("en", "alpha");
    const cont = await page.createCont({ module: "cms.cont.flexible" });
    const rows = () => app.db.col`SELECT url FROM page_url WHERE page_id = ${cont.id}`;

    assertEquals(await cont.urlSeo("en"), "#cmspid" + cont);
    await page.title("en", "beta"); // regenerates the subtree
    assertEquals(await rows(), []);

    await cont.urlSet("en", { url: "#kontakt", custom: 1 });
    await cont.urlsGen("en");
    assertEquals(await cont.urlSeo("en"), "#kontakt");
    await page.title("en", "gamma");
    assertEquals(await rows(), ["#kontakt"]);

    await cont.urlSet("en", { custom: 0 });
    await cont.urlsGen("en");
    assertEquals(await cont.urlSeo("en"), "#cmspid" + cont);
    assertEquals(await rows(), []);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
