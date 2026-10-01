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
