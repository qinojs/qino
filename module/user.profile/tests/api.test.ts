import { App, invoke, requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { api } from "../api.ts";

Deno.test("user.profile: one's own name and address", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.modules.add(new URL("../plugin.ts", import.meta.url));
  await app.init();
  try {
    const user = (name: string) => app.db.table("usr").insert({ active: 1, pw: "", family_name: name }).then(Number);
    const anna = await user("Anna");
    const as = async <T>(userId: number, fn: () => Promise<T>) =>
      requestStorage.run(await testContext({ url: "https://site.test/", app, userId, set: { app } }), fn);

    await as(anna, () => invoke(api, "PUT", "/", { givenName: " Anna ", streetAddress: "Seeweg 2", addressCountry: "ch" }));
    const own = await as(anna, () => invoke(api, "GET", "/")) as Record<string, unknown>;
    assertEquals([own.givenName, own.familyName, own.streetAddress, own.addressCountry], ["Anna", "Anna", "Seeweg 2", "CH"]);
    await assertRejects(() => as(anna, () => invoke(api, "PUT", "/", { iban: "CH00" })));

  } finally {
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
