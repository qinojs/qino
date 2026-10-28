import { App, invoke, requestStorage } from "@qino/qino";
import { assert, assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { api } from "../api.ts";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

Deno.test("user.image: one's own image; signed-in users see it, guests do not", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.modules.add(new URL("../plugin.ts", import.meta.url));
  await app.init();
  try {
    const user = (name: string) => app.db.table("usr").insert({ active: 1, pw: "", family_name: name }).then(Number);
    const anna = await user("Anna"), ben = await user("Ben");
    const as = async <T>(userId: number, fn: () => Promise<T>) =>
      requestStorage.run(await testContext({ url: "https://site.test/", app, userId, set: { app } }), fn);

    await assertRejects(() => as(anna, () => invoke(api, "PUT", "/", { dataUrl: "data:text/plain;base64,aGk=" })));
    const { image } = await as(anna, () => invoke(api, "PUT", "/", { dataUrl: PIXEL })) as { image: string };
    assert(image.includes("dbFile/"), image);
    assertEquals(await as(anna, () => invoke(api, "GET", "/")), { image });
    const id = Number(await app.db.one`SELECT image_id FROM usr WHERE id = ${anna}`);
    const file = await app.dbFiles.file(id);
    assertEquals(await as(ben, () => file.access()), true, "signed-in users see it");
    assertEquals(await as(0, () => file.access()), false, "guests do not");

    await as(anna, () => invoke(api, "DELETE", "/"));
    assertEquals(await app.db.one`SELECT image_id FROM usr WHERE id = ${anna}`, null);
    assertEquals(await file.exists(), undefined, "the old image is gone");
  } finally {
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
