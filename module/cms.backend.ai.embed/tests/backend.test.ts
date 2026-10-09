import { assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { collection, index } from "@qino/qino/ai1.embed";
import { embeddingTable, fakeApp } from "@qino/m/ai1.embed/tests/fake.ts";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.ai1.embed: collections can be managed and searched", async () => {
  const article = { additionalProperties: { properties: { id: { type: "integer", "x-index": "primary" } } } };
  const articleId = { type: "integer", "x-qg-parent": "article", "x-qg-on-parent-delete": "cascade" };
  const { app, db } = await fakeApp("sqlite::memory:", { article, embedding_article_text: embeddingTable({ article_id: articleId }) });
  try {
    let primary = 0;
    const setting = Object.assign((value?: number) => { if (value !== undefined) primary = value; return primary; }, { then: (resolve: (value: number) => void) => resolve(primary) });
    Object.assign(app.settings, { "ai1.embed": { primary: setting, chunkChars: 4000 }, "cms.embed": { auto: false } });
    const node = { app } as Node, api = cms.node.api;

    assertEquals(await api(node, { create: { model: "multi", dimensions: "2" } }), { ok: true });
    assertEquals(await api(node, { create: { model: "wide", dimensions: "3" } }), { ok: true });
    await index(app, "article_text", { article_id: 1 }, "a cat");
    const rendered = String(await cms.node.render(node));
    assertStringIncludes(rendered, "multi</span>/2");
    assertStringIncludes(rendered, "<th>embedding_article_text");
    assertStringIncludes(rendered, "<td>article_id");
    const { hits } = await api(node, { search: "cat" }) as { hits: { name: string; key: object; content: string }[] };
    assertEquals(hits.map((h) => [h.name, h.key, h.content]), [["article_text", { article_id: 1 }, "a cat"]]);

    assertEquals(await api(node, { primary: 2 }), { ok: true });
    assertEquals((await collection(app))?.model, "wide");
    assertEquals(await api(node, { drop: 2 }), { ok: true });
    assertEquals(primary, 0);
    assertEquals((await collection(app))?.model, "multi");
    assertEquals(await api(node, { drop: 1 }), { ok: true });
    assertEquals(Number(await db.one`SELECT COUNT(*) FROM embedding_article_text`), 0);
    assertEquals((await api(node, { config: { chunkChars: "50" } }))?.ok, false);
  } finally { await db.close(); }
});
