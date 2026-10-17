import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms.cont.not_found: suggests readable pages matching the address, and the home page", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.not_found");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const ctx = await Ctx.create(app, new Request("http://qino.test/apple"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    const out = await requestStorage.run(ctx, async () => {
      const page = async (title: string, fields: Record<string, unknown>) => {
        const node = await root.createChild({ searchable: true, ...fields });
        await node.title(ctx.lang, title);
        return node;
      };
      await page("Home", { name: "home", access: 1, online_start: 0 });
      await page("Apple pie", { access: 1, online_start: 0 });
      await page("Apple secret", { access: 0 });
      await page("Apple soon", { access: 1, online_start: Math.floor(Date.now() / 1000) + 1000 });
      const box = await (await root.createChild({ access: 1 })).createCont({ module: "cms.cont.not_found" });
      return String(await box.htmlRaw());
    });
    assertEquals([out.includes("Apple pie"), out.includes("Home")], [true, true], out);
    assertEquals([out.includes("Apple secret"), out.includes("Apple soon")], [false, false], out);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
