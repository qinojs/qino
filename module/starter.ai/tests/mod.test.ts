import { App } from "@qino/qino";
import { assert, assertEquals } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };

const quiet = { sanitizeOps: false, sanitizeResources: false };

Deno.test("starter.ai: every module it brings is in the store", async () => {
  const catalog = JSON.parse(await Deno.readTextFile(new URL("../../store.json", import.meta.url)));
  assertEquals(manifest.dependencies.filter((mod) => !catalog.modules[mod]), []);
});

Deno.test({
  name: "starter.ai: boots on a fresh site and hands its modules over",
  ...quiet,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
    app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("starter.ai");
    await app.init();
    try {
      for (const name of manifest.dependencies) assert(app.modules.linked(name), name);
      const rows = (await app.db.query`SELECT name FROM module WHERE url IS NOT NULL`).map((r) => r.name);
      assert(rows.includes("cms.backend.ai.chat") && !rows.includes("starter.cms"), "the modules are the site's");
      assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM page WHERE name = 'todo-ai'`), 1);
    } finally {
      await app.db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
