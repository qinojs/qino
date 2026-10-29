import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { assertEquals } from "@qino/qino/tests";

const OLD = "cms.backend.superuser.git";
const NEW = "cms.backend.superuser.module.git";

Deno.test({
  name: "cms.backend.superuser.module.git: install takes over the page of cms.backend.superuser.git and moves it",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    const store = import.meta.resolve("../../store.json");
    const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
    app.stores.add(store).add("cms");
    await app.init();
    try {
      const cm = cms(app);
      const old = await backend.install(app, OLD, { en: "Git" });
      await app.db.table("module").ensure({ name: OLD, url: "file:///gone/plugin.ts" }); // no longer importable
      await app.stores.add(store).install(NEW);

      assertEquals((await cm.nodesByModule(OLD)).size, 0);
      const page = await (await cm.nodeByModule(NEW))?.page();
      assertEquals(page?.id, old?.id, "the page is kept, with its access and title");
      assertEquals((await page?.parent())?.id, (await (await cm.nodeByModule("cms.backend.superuser.module"))?.page())?.id);
      assertEquals(await app.db.table("module").get(OLD), undefined, "the old module is retired");
    } finally {
      await app.db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
