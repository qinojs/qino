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

Deno.test("cms: child finds the page of that name, creates it with defaults otherwise; layouts live in system/layout", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    const root = await cms(app).node(1);
    await root.cont("system"); // a cont of that name is no page
    const system = await root.child("system", { visible: false });
    assertEquals([system.vs.type, system.vs.name, !!system.vs.visible], ["p", "system", false]);
    assertEquals((await root.child("system")).id, system.id);

    const layoutPage = await cms(app).layoutPage("cms.layout.system");
    const layouts = await system.child("layout");
    assertEquals(Number(layoutPage.vs.basis), layouts.id);
    assertEquals((await cms(app).layoutPage("cms.layout.system")).id, layoutPage.id);
    assertEquals((await cms(app).nodeByPath(["system", "layout"]))?.id, layouts.id);
    assertEquals(await cms(app).nodeByPath(["system", "nowhere"]), undefined); // finds, never makes
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
