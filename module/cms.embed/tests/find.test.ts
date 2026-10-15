import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { collections, create, drop } from "@qino/qino/ai.embed";
import { assertEquals } from "@qino/qino/tests";

import { find, sync } from "../mod.ts";
import { api } from "../plugin.ts";

// "cat" means one thing, all else another.
const embed = (_call: unknown, { texts }: { texts: string[] }) => Promise.resolve(texts.map((t) => /cat/i.test(t) ? [1, 0] : [0, 1]));

Deno.test("cms.embed: pages found by meaning, each once, only those readable and searchable", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.embed");
  await app.init();
  app.modules.get("ai")!.plugin.aiAdapters.fake = { embed };
  try {
    await app.db.table("ai_provider").insert({ name: "fake", type: "fake", endpoint: "" });
    await app.db.table("ai_model").insert({ name: "m" });
    await app.db.table("ai_model_provider").insert({ model_id: 1, provider_id: 1 });
    await app.db.table("ai_model_capability").insert({ model_id: 1, capability: "embed" });
    for (const { id } of await collections(app)) await drop(app, id); // the one installed
    await create(app, "m", 2);

    const root = await cms(app).node(1);
    const page = (searchable: boolean, access = 1) => root.createChild({ access, searchable, online_start: 0 });
    const [cat, dog, hidden, secret] = [await page(true), await page(true), await page(false), await page(true, 0)];
    const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    const found = await requestStorage.run(ctx, async () => {
      for (const [node, title, text] of [[cat, "Cats", "<p>A cat</p>"], [dog, "Dogs", "<p>A dog</p>"], [hidden, "Hidden", "<p>A cat</p>"], [secret, "Secret", "<p>A cat</p>"]] as const) {
        await node.title(ctx.lang, title);
        await node.text("main", ctx.lang, text);
      }
      await sync(app);
      return {
        pages: (await find(ctx, "cat")).map(({ page }) => page.id),
        api: await (api.search as any).get.execute({ search: "cat", limit: 1 }, ctx),
      };
    });
    assertEquals(found.pages[0], cat.id); // the cat first
    assertEquals([hidden.id, secret.id].filter((id) => found.pages.includes(id)), []); // not searchable, not readable: left out
    assertEquals(found.api.map(({ id, title, score }: any) => [id, title, score]), [[cat.id, "Cats", 1]]);
  } finally {
    delete app.modules.get("ai")!.plugin.aiAdapters.fake;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
