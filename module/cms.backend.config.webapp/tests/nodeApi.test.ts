import { $item, App } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import api from "../nodeApi.ts";

Deno.test("cms.backend.config.webapp saves normalized and typed settings", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", appPATH: dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("webapp");
  await app.init();
  const node = { app } as never;
  try {
    await api(node, { save: {
      display: "standalone",
      telephoneDetection: false,
      categories: " Business, productivity\nBUSINESS ",
    } });
    const settings = app.settings[$item].sub(["webapp"]);
    assertEquals(await settings.sub("display").proxy, "standalone");
    assertEquals(await settings.sub("telephoneDetection").proxy, false);
    assertEquals(await settings.sub("categories").proxy, "business\nproductivity");
    await assertRejects(() => api(node, { save: { display: "windowed" } }), Error, "Invalid display mode");
  } finally {
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
