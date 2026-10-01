// deno-lint-ignore-file no-explicit-any
import { App, runAs } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";
import { collections, drop } from "@qino/qino/ai1.embed";

const BRAVE = { web: { results: [{ title: "Qino", url: "https://qino.test/", description: "A CMS", extra: 1 }] } };

Deno.test("ai1.web: search asks the first engine with a key", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "cron", "ai1.embed", "ai1.web"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  const fetchOrg = globalThis.fetch, asked: Request[] = [];
  globalThis.fetch = (input, init) => (asked.push(new Request(input, init)), Promise.resolve(Response.json(BRAVE)));
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const search = (query: Record<string, unknown>) => runAs(app, 7, "test", () => (app.api as any)["ai1.web"].search.get(undefined, query));

    await assertRejects(() => search({ query: "qino" }), Error, "No search engine"); // no key yet
    await app.settings.core.keys["api.search.brave.com"]("sk-brave");
    assertEquals(await search({ query: "qino", count: 50 }), [{ title: "Qino", url: "https://qino.test/", snippet: "A CMS" }]);
    const url = new URL(asked[0].url);
    assertEquals([url.searchParams.get("q"), url.searchParams.get("count"), asked[0].headers.get("x-subscription-token")], ["qino", "20", "sk-brave"]);

    // Brave fails: Serper takes over
    await app.settings.core.keys["google.serper.dev"]("sk-serper");
    globalThis.fetch = (input) => Promise.resolve(String(input).includes("brave")
      ? new Response("quota", { status: 429 })
      : Response.json({ organic: [{ title: "Qino", link: "https://qino.test/", snippet: "From Google" }] }));
    assertEquals(await search({ query: "qino" }), [{ title: "Qino", url: "https://qino.test/", snippet: "From Google" }]);
    globalThis.fetch = () => Promise.resolve(new Response("quota", { status: 429 }));
    await assertRejects(() => search({ query: "qino" }), Error, "Brave: HTTP 429 quota; Serper: HTTP 429 quota");
  } finally {
    globalThis.fetch = fetchOrg;
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});

Deno.test("ai1.web: read a page by the chosen reader, keep it, find it", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "cron", "ai1.embed", "ai1.web"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  const fetchOrg = globalThis.fetch, asked: string[] = [];
  globalThis.fetch = (input) => {
    asked.push(String(input));
    return Promise.resolve(Response.json({ data: { title: "Qino", content: "# Qino\n\nA CMS for agents" } }));
  };
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const web = (app.api as any)["ai1.web"];
    const as = (call: () => Promise<any>) => runAs(app, 7, "test", call);

    // our own fetch by default, which never reaches our own network
    await assertRejects(() => as(() => web.read.get(undefined, { url: "http://127.0.0.1/" })), Error, "SSRF blocked");
    await assertRejects(() => as(() => web.read.get(undefined, { url: "file:///etc/passwd" })), Error, "http or https");

    await app.settings["ai1.web"].reader("jina");
    await assertRejects(() => as(() => web.read.get(undefined, { url: "https://qino.test/A" })), Error, "set a key in core.keys for api.jina.ai");
    await app.settings.core.keys["api.jina.ai"]("sk-jina");
    const page = await as(() => web.read.get(undefined, { url: "https://qino.test/A" }));
    assertEquals([page.title, page.content, page.reader], ["Qino", "# Qino\n\nA CMS for agents", "jina"]);
    const part = await as(() => web.read.get(undefined, { url: "https://qino.test/A", offset: 2, length: 4 }));
    assertEquals([part.content, part.offset, part.size], ["Qino", 2, 24]); // a part at a time
    assertEquals(asked, ["https://r.jina.ai/https://qino.test/A"]);
    await as(() => web.read.get(undefined, { url: "https://qino.test/A" })); // kept: not read again
    await as(() => web.read.get(undefined, { url: "https://qino.test/a" })); // another page: paths are case-sensitive
    await as(() => web.read.get(undefined, { url: "https://qino.test/A", maxAge: 0 })); // read again, the same row
    assertEquals(asked.length, 3);
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM ai1_web_page`), 2);

    // without an embedding collection: by its words
    for (const { id } of await collections(app)) await drop(app, id);
    assertEquals((await as(() => web.pages.get(undefined, { search: "agents" }))).map((p: any) => p.url).sort(), ["https://qino.test/A", "https://qino.test/a"]);
    assertEquals(await as(() => web.pages.get(undefined, { search: "nothing" })), []);
  } finally {
    globalThis.fetch = fetchOrg;
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});

// A site: /docs/ links to its pages, an image, a page outside /docs/ and another site; /docs/a on to /docs/c.
const SITE: Record<string, string> = {
  "https://site.test/docs/": "# Docs\n\n[A](a) [B](/docs/b#part) ![logo](logo.png) [Other](/other) <https://elsewhere.test/>",
  "https://site.test/docs/a": "# A\n\n[C](c) [back](/docs/)",
  "https://site.test/docs/b": "# B about crawling",
  "https://site.test/docs/c": "# C",
};

Deno.test("ai1.web: crawl reads the pages below a url, at most max; pages finds them by root", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "cron", "ai1.embed", "ai1.web"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  const fetchOrg = globalThis.fetch, asked: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input).replace("https://r.jina.ai/", "");
    asked.push(url);
    return Promise.resolve(url in SITE ? Response.json({ data: { title: url, content: SITE[url] } }) : new Response("gone", { status: 404 }));
  };
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    await app.settings["ai1.web"].reader("jina");
    await app.settings.core.keys["api.jina.ai"]("sk-jina");
    for (const { id } of await collections(app)) await drop(app, id); // by words
    const web = (app.api as any)["ai1.web"];
    const as = (call: () => Promise<any>) => runAs(app, 7, "test", call);

    assertEquals(await as(() => web.crawl.post({ url: "https://site.test/docs/", max: 2, wait: true })), { read: 2, failed: [], left: 2 }); // b and c still to read
    assertEquals(asked, ["https://site.test/docs/", "https://site.test/docs/a"]); // below /docs/ only, no image
    assertEquals(await as(() => web.crawl.post({ url: "https://site.test/docs/", wait: true })), { read: 4, failed: [], left: 0 });
    assertEquals(asked.length, 4); // the two read before came from the cache

    await app.db.table("ai1_web_page").insert({ url: "https://elsewhere.test/crawling", url_hash: "y", title: "", content: "crawling", reader: "fetch", time: 1 });
    const found = (query: Record<string, string>) => as(() => web.pages.get(undefined, query)).then((rows) => rows.map((p: any) => p.url).sort());
    assertEquals(await found({ search: "crawling" }), ["https://elsewhere.test/crawling", "https://site.test/docs/b"]);
    assertEquals(await found({ search: "crawling", root: "https://site.test/docs/" }), ["https://site.test/docs/b"]);
    assertEquals((await found({ root: "https://site.test/" })).length, 4);
    assertEquals(await as(() => web.crawl.post({ url: "https://site.test/docs/" })), { started: "https://site.test/docs/" }); // in the background
  } finally {
    globalThis.fetch = fetchOrg;
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
