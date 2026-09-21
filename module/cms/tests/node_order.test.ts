import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms: new children append, also past sort gaps and from xml", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const far = await root.createChild({ sort: 900 });
    const next = await root.createChild();
    const ids = async () => [...(await root.children()).keys()];
    assertEquals((await ids()).slice(-2), [far.id, next.id]);

    const page = await root.createChild();
    await page.fromXml(`<page><cont module="cms.cont.text" name="a"/><cont module="cms.cont.text" name="b"/></page>`);
    assertEquals((await page.conts()).map((c) => c.vs.name), ["a", "b"]);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
