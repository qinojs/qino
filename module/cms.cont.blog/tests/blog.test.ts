import { test } from "node:test";
import { App, fs, getCtx, runAs, unixTime } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";

test("blog lists published posts and serves escaped Atom and RSS feeds", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.blog").add("cms.layout.standard.2");
  await app.init();
  app.languages.setLangs(["en", "de"]);
  await app.settings.core.url("https://qino.test/");
  try {
    const root = await cms(app).node(1);
    const page = await root.createChild({ access: 1, searchable: true });
    await page.title("en", "News & notes");
    await page.title("de", "Neues & Notizen");
    const blog = await page.cont("main", "cms.cont.blog");
    const live = await page.createChild({ access: 1, searchable: true, online_start: 1726560000 });
    await live.title("en", "Coffee < tea");
    await live.title("de", "Kaffee < Tee");
    await live.text("_meta_description", "en", "A short & useful post");
    await live.text("_meta_description", "de", "Ein kurzer & nützlicher Beitrag");
    const brief = await page.createChild({ access: 1, searchable: true, online_start: 1726473600 });
    await brief.title("en", "Without an excerpt");
    const hidden = await page.createChild({ access: 0, searchable: true, online_start: 1726646400 });
    await hidden.title("en", "Private draft");
    const scheduled = await page.createChild({ access: 1, searchable: true, online_start: unixTime() + 3600 });
    await scheduled.title("en", "Scheduled draft");

    const path = await page.urlSeo("en");
    const url = `https://qino.test/${path}`;
    const document = await (await app.fetch(new Request(url))).text();
    assertStringIncludes(document, "Coffee &lt; tea");
    assert(!document.includes("<h1"), "no heading without the block's own title");
    assertStringIncludes(document, "A short &amp; useful post");
    assert(!document.includes("Private draft"));
    assert(!/<h2><a[^>]*>Scheduled draft<\/a>/.test(document));
    assertStringIncludes(document, "application/atom+xml");
    assertStringIncludes(document, "application/rss+xml");
    assertStringIncludes(document, 'property="og:type" content="website"');
    assertStringIncludes(document, `<link href="${url}" rel="alternate" hreflang="en">`);
    assertStringIncludes(document, `<link rel="canonical" href="${url}">`);
    assertEquals(await app.db.one`SELECT text_id FROM page_text WHERE page_id = ${brief.id} AND name = '_meta_description'`, undefined);
    await blog.title("en", "Notes & <em>more</em>");
    assertStringIncludes(await (await app.fetch(new Request(url))).text(), "Notes &amp; <em>more</em></h1>");

    const atom = await app.fetch(new Request(url + `?cms_blog=${blog.id}`));
    assertEquals(atom.headers.get("content-type"), "application/atom+xml; charset=utf-8");
    const xml = await atom.text();
    assertStringIncludes(xml, "Coffee &lt; tea");
    assertStringIncludes(xml, "A short &amp; useful post");
    assertStringIncludes(xml, "<author><name>News &amp; notes</name></author>");
    assert(!xml.includes("Private draft"));
    assert(!xml.includes("Scheduled draft"));
    assertStringIncludes(xml, `<updated>2024-09-17T08:00:00.000Z</updated>`);

    const rss = await app.fetch(new Request(url + `?cms_blog=${blog.id}&cms_blog_format=rss`));
    assertEquals(rss.headers.get("content-type"), "application/rss+xml; charset=utf-8");
    assertStringIncludes(await rss.text(), "<rss version=\"2.0\">");

    const deUrl = "https://qino.test/" + await page.urlSeo("de");
    const deFeed = await app.fetch(new Request(deUrl + `?cms_blog=${blog.id}`));
    const deXml = await deFeed.text();
    assertStringIncludes(deXml, 'xml:lang="de"');
    assertStringIncludes(deXml, "Kaffee &lt; Tee");
    assertStringIncludes(deXml, "Ein kurzer &amp; nützlicher Beitrag");

    const privatePage = await root.createChild({ access: 0 });
    const privateBlog = await privatePage.cont("main", "cms.cont.blog");
    const denied = await app.fetch(new Request(url + `?cms_blog=${privateBlog.id}`));
    assertEquals(denied.status, 404);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});

test("blog archive pages only load their visible posts", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.blog").add("cms.layout.standard.2");
  await app.init();
  app.languages.setLangs(["en", "de"]);
  await app.settings.core.url("https://qino.test/");
  try {
    const page = await (await cms(app).node(1)).createChild({ access: 1, searchable: true });
    await page.title("en", "Archive");
    await page.cont("main", "cms.cont.blog");
    for (let i = 0; i < 21; i++) {
      const post = await page.createChild({ access: 1, searchable: true, online_start: 1700000000 + i });
      await post.title("en", `Post ${i}`);
    }

    const url = "https://qino.test/" + await page.urlSeo("en");
    const first = await (await app.fetch(new Request(url))).text();
    assertStringIncludes(first, "Post 20");
    assert(!/<h2><a[^>]*>Post 0<\/a>/.test(first));
    assertStringIncludes(first, "cms_blog_page=2");
    const second = await (await app.fetch(new Request(url + "?cms_blog_page=2"))).text();
    assertStringIncludes(second, "Post 0");
    assert(!/<h2><a[^>]*>Post 20<\/a>/.test(second));
    assertStringIncludes(second, 'rel=prev');
    assertStringIncludes(second, `<link rel="canonical" href="${url}?cms_blog_page=2">`);
    const deUrl = "https://qino.test/" + await page.urlSeo("de");
    assertStringIncludes(second, `href="${deUrl}?cms_blog_page=2" rel="alternate" hreflang="de"`);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});

test("editors create posts as drafts and see what is missing", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.blog").add("cms.cont.blog.post").add("cms.layout.standard.2");
  await app.init();
  await app.settings.core.url("https://qino.test/");
  try {
    const page = await (await cms(app).node(1)).createChild({ access: 1, searchable: true });
    await page.title("en", "Blog");
    const blog = await page.cont("main", "cms.cont.blog");
    const admin = Number(await app.db.table("usr").insert({ username: "admin@example.test", active: 1, superuser: 1 }));
    const asEditor = (fn: () => Promise<unknown>) => runAs(app, admin, "test", () => {
      cmsCtx(getCtx()).editmode = 1;
      return fn();
    });

    await asEditor(() => blog.html({ create: "1", title: "Fresh idea" }));
    const [post] = (await page.children({ type: "p" })).values();
    assertEquals(await post.title("en"), "Fresh idea");
    assertEquals(post.vs.access, 0);
    assertEquals((await (await post.cont("main")).conts())[0]?.vs.module, "cms.cont.blog.post");

    const list = String(await asEditor(() => blog.html()));
    assertStringIncludes(list, "Fresh idea</a> <small>Draft</small>");
    assertStringIncludes(list, "No description");
    assertStringIncludes(list, 'name=create');
    assert(!(await (await app.fetch(new Request("https://qino.test/" + await page.urlSeo("en")))).text()).includes("Fresh idea"));
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
