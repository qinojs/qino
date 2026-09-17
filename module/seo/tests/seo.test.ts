import { App } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

Deno.test("seo serves robots.txt and a cached sitemap from seo:sitemap entries", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir, appUrl: "/site/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("seo");
  await app.init();
  try {
    const robots = await app.fetch(new Request("https://qino.test/site/robots.txt"));
    assertEquals(robots.headers.get("content-type"), "text/plain; charset=utf-8");
    assertEquals(await robots.text(), "User-agent: *\nAllow: /\n\nSitemap: https://qino.test/site/sitemap.xml\n");

    const en = "https://qino.test/site/about", de = "https://qino.test/site/ueber";
    app.on("seo:sitemap", ({ base, urls }) => {
      urls.push(base + "a&b", { url: { en, de }, lastmod: 1726560000, image: base + "main.png" });
    });
    const res = await app.fetch(new Request("https://qino.test/site/sitemap.xml"));
    assertEquals(res.headers.get("cache-control"), "public, max-age=3600");
    const xml = await res.text();
    const extra = `<lastmod>2024-09-17T08:00:00.000Z</lastmod><image:image><image:loc>https://qino.test/site/main.png</image:loc></image:image>`
      + `<xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="de" href="${de}"/>`;
    assertEquals(xml.split("\n").slice(2, -2), [
      `<url><loc>https://qino.test/site/a&amp;b</loc></url>`,
      `<url><loc>${en}</loc>${extra}</url>`,
      `<url><loc>${de}</loc>${extra}</url>`,
    ]);

    app.on("seo:sitemap", ({ urls }) => { urls.push("https://qino.test/site/shop/"); });
    const cached = await (await app.fetch(new Request("https://qino.test/site/sitemap.xml"))).text();
    assertEquals(cached, xml);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
