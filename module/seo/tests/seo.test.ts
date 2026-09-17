import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

Deno.test("seo serves robots.txt and a cached sitemap with public cms pages", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir, appUrl: "/site/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("seo");
  await app.init();
  app.languages.setLangs(["en", "de"]);
  try {
    const root = await cms(app).node(1);
    const page = await root.createChild({ access: 1, searchable: true });
    await page.title("en", "About");
    const hidden = await root.createChild({ access: 0, searchable: true });
    await hidden.createChild({ access: 1, searchable: true });
    await root.createChild({ access: 1, searchable: false });
    const file = await app.dbFiles.add(new File([new Uint8Array([137, 80, 78, 71])], "main.png", { type: "image/png" }));
    await page.addFile(file, "main");
    const logId = await app.db.table("log").insert({ time: 1726560000 });
    await app.db.table("node_changed").insert({ log_id: logId, node_id: page.id, page_id: page.id, data: "{}" });

    const robots = await app.fetch(new Request("https://qino.test/site/robots.txt"));
    assertEquals(robots.headers.get("content-type"), "text/plain; charset=utf-8");
    assertEquals(await robots.text(), "User-agent: *\nAllow: /\n\nSitemap: https://qino.test/site/sitemap.xml\n");

    const res = await app.fetch(new Request("https://qino.test/site/sitemap.xml"));
    assertEquals(res.headers.get("cache-control"), "public, max-age=3600");
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    const en = "https://qino.test/site/" + await page.urlSeo("en");
    const de = "https://qino.test/site/" + await page.urlSeo("de");
    assertEquals(locs, [en, de]);
    assertStringIncludes(xml, `<xhtml:link rel="alternate" hreflang="de" href="${de}"/>`);
    assertStringIncludes(xml, `<loc>${en}</loc><lastmod>2024-09-17T08:00:00.000Z</lastmod><image:image><image:loc>https://qino.test/site/dbFile/${file.id}/`);

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
