import { App, runAs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, assertRejects } from "@qino/qino/tests";

// A text in a language the site doesn't have would be kept, but never shown: the api refuses it.
Deno.test("cms: the api writes texts and titles only in the site's languages", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    const usr = Number(await app.db.table("usr").insert({ username: "su@example.test", active: 1, superuser: 1 }));
    const node = await (await cms(app).node(1)).createChild();
    const api = () => app.api.cms.node(node.id);
    const def = app.languages.def;
    assertEquals(await runAs(app, usr, "test", () => api().text("main").put({ value: "hi", lang: def })), { changed: true });
    const writes = [() => api().text("main").put({ value: "hi", lang: "xx" }), () => api().title.put({ value: "hi", lang: "xx" })];
    for (const write of writes) {
      await assertRejects(() => runAs(app, usr, "test", write), Error, `Unknown language "xx"`);
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
