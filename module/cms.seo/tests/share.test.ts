import { test } from "node:test";
import { App, fs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertStringIncludes } from "@qino/qino/tests";

test("cms.seo sets the tags for shared links from the page's values", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.seo").add("cms.layout.standard.2");
  await app.init();
  try {
    const page = await (await cms(app).node(1)).createChild({ access: 1, searchable: true });
    await page.title("en", "About us");
    await page.text("_description", "en", "Who we are & what we do");
    const url = "https://qino.test/" + await page.urlSeo("en");
    const get = async () => await (await app.fetch(new Request(url))).text();

    const plain = await get();
    assertStringIncludes(plain, '<meta property="og:title" content="About us">');
    assertStringIncludes(plain, '<meta property="og:description" content="Who we are &amp; what we do">');
    assertStringIncludes(plain, '<meta name="twitter:card" content="summary">');
    assert(!plain.includes("og:image"));

    await page.text("_share_title", "en", "Meet the team");
    const file = await app.dbFiles.add(new File([new Uint8Array([137, 80, 78, 71])], "team.png", { type: "image/png" }));
    await page.addFile(file, "share");
    const shared = await get();
    assertStringIncludes(shared, '<meta property="og:title" content="Meet the team">');
    assertStringIncludes(shared, `<meta property="og:image" content="https://qino.test/dbFile/${file.id}/`);
    assertStringIncludes(shared, '<meta name="twitter:card" content="summary_large_image">');
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
