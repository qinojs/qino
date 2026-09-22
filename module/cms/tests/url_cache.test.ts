import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

Deno.test("cms: a renamed page is found under its new url, not the cached old one", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    const status = async (path: string) => {
      const res = await app.handle(new Request("http://localhost/" + path));
      await res.body?.cancel();
      return res.status;
    };
    const page = await (await cms(app).node(1)).createChild();
    await page.title("en", "alpha");
    assertEquals(await status("en/alpha"), 200);
    assertEquals(await status("en/alpha"), 200); // served from the cache

    await page.title("en", "beta");
    assertEquals(await status("en/beta"), 200);
    assert(await status("en/alpha") !== 200); // not found; the fallback page decides the status
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
