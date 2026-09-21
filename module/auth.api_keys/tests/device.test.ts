import { App } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { generateToken, hashToken, keyPrefix } from "../lib/keys.ts";

Deno.test("auth.api_keys: a key is one device — same client and session on every request, no cookies", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("auth.api_keys");
  await app.init();
  try {
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const token = generateToken();
    await app.db.table("api_key").insert({ usr_id: 7, name: "agent", prefix: keyPrefix(token), hash: hashToken(token), created: 0 });

    const call = () => app.fetch(new Request("https://qino.test/", { headers: { authorization: "Bearer " + token } }));
    for (const res of [await call(), await call()]) {
      await res.body?.cancel();
      assertEquals(res.headers.get("set-cookie"), null);
    }
    await new Promise((r) => setTimeout(r, 100)); // touch and log are written in the background

    assertEquals(await app.db.query`SELECT usr_id FROM sess`, [{ usr_id: 7 }]);
    assertEquals(await app.db.one`SELECT count(*) FROM client`, 1);
    assertEquals(await app.db.one`SELECT count(DISTINCT client_id) FROM log`, 1);
  } finally {
    await app.db.close();
  }
});
