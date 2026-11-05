import { test } from "node:test";
import { App, fs, getCtx, runAs, unixTime } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";

test("blog post creates a moderated comment form only for an editor", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.blog.post").add("cms.layout.standard.2");
  await app.init();
  app.languages.setLangs(["en", "de", "fr"]);
  try {
    await app.settings.core.url("https://qino.test/");
    const root = await cms(app).node(1);
    const page = await root.createChild({ access: 1, searchable: true });
    await page.title("en", "First post");
    const post = await page.cont("main", "cms.cont.blog.post");
    const admin = Number(await app.db.table("usr").insert({ username: "admin@example.test", active: 1, superuser: 1 }));

    const initial = await (await app.fetch(new Request("https://qino.test/" + await page.urlSeo("en")))).text();
    assertStringIncludes(initial, '<link rel="canonical" href="https://qino.test/en/first-post">');
    assertEquals((await post.conts()).length, 0);
    assertStringIncludes(initial, "<h1>First post</h1>", "the page's title until the block has its own");

    const out = await runAs(app, admin, "test", async () => {
      cmsCtx(getCtx()).editmode = 1;
      return String(await post.html());
    });
    assertStringIncludes(out, 'name="comment"');
    assertStringIncludes(out, "Post comment");
    assertEquals(await post.title("en"), "First post", "first edit takes the page's title");
    await post.title("en", "Edited on the page");
    assertStringIncludes(await (await app.fetch(new Request("https://qino.test/" + await page.urlSeo("en")))).text(), "Edited on the page</h1>");
    const children = await post.conts();
    const form = children.find((child) => child.vs.module === "cms.cont.form");
    const entries = children.find((child) => child.vs.module === "cms.cont.form.entries");
    assert(form && entries);
    assertEquals(entries.settings.moderated(), true);
    assertEquals(JSON.parse(String(form.vs.settings)).listing_nodes[entries.id], true);
    assertEquals(entries.settings.show_fields(), "name,comment");
    assertEquals(await (await form.text("button_submit", "de")).get(), "Kommentar absenden");
    assertEquals(await (await form.text("button_submit", "fr")).get(), "Post comment", "every language gets a text");
    await runAs(app, admin, "test", async () => {
      cmsCtx(getCtx()).editmode = 1;
      await post.html();
    });
    assertEquals((await post.conts()).length, 2, "subsequent edits keep the same form");

    const url = "https://qino.test/" + await page.urlSeo("en");
    const shown = await app.fetch(new Request(url));
    const token = (await shown.text()).match(/name=csrfToken value="([^"]+)"/)?.[1];
    assert(token);
    const cookie = shown.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    await new Promise((resolve) => setTimeout(resolve, 50)); // session token is saved in the background
    for (const row of await app.db.query`SELECT id FROM log`)
      await app.db.table("log").update(Number(row.id), { time: unixTime() - 30 });
    const sent = await app.fetch(new Request(url, {
      method: "POST",
      headers: { origin: "https://qino.test", cookie },
      body: new URLSearchParams({ "qcms-node": String(form.id), csrfToken: token, name: "Ada", email: "ada@example.test", comment: "A <script> & useful thought" }),
    }));
    assertEquals(sent.status, 200);
    const entry = await app.db.row`SELECT id, data, released, spam FROM form_entry WHERE node_id = ${form.id}`;
    assert(entry);
    assertEquals(JSON.parse(String(entry.data)).comment, "A <script> & useful thought");
    const pending = await (await app.fetch(new Request(url))).text();
    assert(!pending.includes("A &lt;script&gt; &amp; useful thought"));
    const ownPending = await (await app.fetch(new Request(url, { headers: { cookie } }))).text();
    assertStringIncludes(ownPending, "A &lt;script&gt; &amp; useful thought");
    await app.db.table("form_entry").update(Number(entry.id), { released: true });
    const released = await (await app.fetch(new Request(url))).text();
    assertStringIncludes(released, "A &lt;script&gt; &amp; useful thought");
    assert(!released.includes("A <script>"));
    assert(!released.includes("ada@example.test"));
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
