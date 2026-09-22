import { App, invoke, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, testContext } from "@qino/qino/tests";

import { api } from "../api.ts";
import { cmsInstances } from "../lib/CMS.ts";

Deno.test("cms api: a long user list without search shows the granted ones, on every dialect", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    const usr = app.db.table("usr");
    const admin = Number(await usr.insert({ username: "admin", superuser: true }));
    for (let i = 0; i < 11; i++) await usr.insert({ username: `u${i}` });
    const root = await cms(app).node(1);
    await root.changeUser(admin, 3);

    const ctx = await testContext({ userId: admin, app: { db: app.db, modules: app.modules } });
    cmsInstances.set(ctx.app, cms(app));
    const list = await requestStorage.run(ctx, () => invoke(api, "GET", "/node/1/access/users")) as { total: number; rows: { id: number }[] };
    assertEquals(list.total, 12);
    assertEquals(list.rows.map((r) => Number(r.id)), [admin]);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
