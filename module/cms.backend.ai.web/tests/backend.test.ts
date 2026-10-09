import { App, runAs, unixTime } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { cms, list } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.web: the reader, the keys and the pages read", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["ai1", "cron", "ai1.embed", "ai1.web"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const id = await app.db.table("ai1_web_page").insert({ url: "https://qino.test/", url_hash: "x", title: "<b>Qino</b>", content: "A CMS", reader: "fetch", time: unixTime() });
    const node = { app } as unknown as Node, api = cms.node.api;

    assertEquals(await api(node, { reader: "jina" }), { ok: true });
    assertEquals(await app.settings["ai1.web"].reader, "jina");
    assertEquals((await api(node, { reader: "nobody" }) as { ok: boolean }).ok, false);
    assertEquals(await api(node, { key: { name: "api.search.brave.com", value: " sk-1234 " } }), { ok: true });
    assertEquals(await app.settings.core.keys["api.search.brave.com"], "sk-1234");
    assertEquals((await api(node, { key: { name: "api.openai.com", value: "x" } }) as { ok: boolean }).ok, false); // only its own

    const page = String(await runAs(app, 7, "test", () => cms.node.render(node)));
    assertEquals(page.includes("[object Promise]"), false);
    for (const part of ["…1234", "<option selected>jina", "&lt;b&gt;Qino&lt;/b&gt;", "A CMS", `data-id="${id}"`]) assertStringIncludes(page, part);
    // crawl, and wait for it
    await app.settings.core.keys["api.jina.ai"]("sk-jina");
    const fetchOrg = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(Response.json({ data: { title: "Docs", content: "no links" } }));
    try {
      assertEquals(await api(node, { crawl: { url: "https://site.test/docs/", max: "5" } }), { ok: true, result: { read: 1, failed: [], left: 0 } });
    } finally { globalThis.fetch = fetchOrg; }
    assertEquals((await api(node, { crawl: { url: "ftp://site.test/" } }) as { ok: boolean }).ok, false);
    assertStringIncludes(String(await runAs(app, 7, "test", () => list(node, { vars: { root: "https://site.test/" } }))), "https://site.test/docs/");
    assertEquals(String(await runAs(app, 7, "test", () => list(node, { vars: { root: "https://nowhere.test/" } }))).includes("site.test"), false);

    assertEquals(await api(node, { remove: id }), { ok: true });
    assertEquals((await app.db.col`SELECT id FROM ai1_web_page`).map(Number).includes(Number(id)), false);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
