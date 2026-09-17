import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

Deno.test("seo serves robots.txt and a cached sitemap with public cms pages", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir, appUrl: "/site/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("seo");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const page = await root.createChild({ access: 1, searchable: true });
    await page.title("en", "About");
    const hidden = await root.createChild({ access: 0, searchable: true });
    await hidden.createChild({ access: 1, searchable: true });
    await root.createChild({ access: 1, searchable: false });

    const robots = await app.fetch(new Request("https://qino.test/site/robots.txt"));
    assertEquals(robots.headers.get("content-type"), "text/plain; charset=utf-8");
    assertStringIncludes(await robots.text(), "Sitemap: https://qino.test/site/sitemap.xml");

    const res = await app.fetch(new Request("https://qino.test/site/sitemap.xml"));
    assertEquals(res.headers.get("cache-control"), "public, max-age=3600");
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    assertEquals(locs, ["https://qino.test/site/" + await page.urlSeo(app.languages.def)]);

    const extra = "https://qino.test/site/shop/";
    app.on("seo:sitemap", ({ urls }) => { urls.push(extra); });
    const cached = await (await app.fetch(new Request("https://qino.test/site/sitemap.xml"))).text();
    assertEquals(cached, xml);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
