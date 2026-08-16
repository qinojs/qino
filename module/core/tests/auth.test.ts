import { assert, assertEquals, testContext } from "./deps.ts";
import { authListen, login } from "../lib/auth.ts";
import { App, Ctx, requestStorage, unixTime } from "../mod.ts";

Deno.test("authListen: login form requires token", async () => {
  const ctx = await testContext({
    sess: { data: { core: { userId: () => 0, csrfToken: () => "good" } } },
    app: { db: { row: () => { throw new Error("auth should not run"); } } },
    set: { post: { core_login: "", email: "u@example.test", pw: "pw", csrfToken: "bad" } },
  });

  await authListen(ctx);
  assertEquals(ctx.loginError, undefined);
});

Deno.test("authListen: login form requires POST", async () => {
  const ctx = await testContext({
    method: "PUT",
    sess: { data: { core: { userId: () => 0, csrfToken: () => "good" } } },
    app: { db: { row: () => { throw new Error("auth should not run"); } } },
    set: { post: { core_login: "", email: "u@example.test", pw: "pw", csrfToken: "good" } },
  });

  await authListen(ctx);
  assertEquals(ctx.loginError, undefined);
});

// logout() empties the very item login() hands to the listeners, so what they get has to be a
// snapshot — otherwise a module carrying something over the login (a shop cart) finds it gone.
Deno.test("login: auth:login carries the session as it was before the logout", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json"));
  await app.init();
  try {
    await app.db.table("usr").insert({ id: 7, email: "ann@example.test", active: true });
    let seen: Record<string, any> | undefined;
    app.on("auth:login", (e) => { seen = e.oldSession; });

    const ctx = await Ctx.create(app, new Request("http://test/"), { appUrl: "/" });
    ctx.clientId = "1";
    await app.db.table("client").insert({ id: 1 });
    ctx.sess.data.shp3.cartId("42");

    await requestStorage.run(ctx, async () => {
      assertEquals(await login(ctx, 7), true);
      assertEquals(seen?.shp3?.cartId, "42");
      assertEquals(ctx.sess.data.shp3.cartId(), undefined); // the new session starts empty
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("login: how the identity was had is recorded, and the rotation drops it", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json"));
  await app.init();
  try {
    await app.db.table("usr").insert({ id: 7, email: "ann@example.test", active: true });
    await app.db.table("client").insert({ id: 1 });

    const ctx = await Ctx.create(app, new Request("http://test/"), { appUrl: "/" });
    ctx.clientId = "1";

    await requestStorage.run(ctx, async () => {
      const before = unixTime();
      assertEquals(await login(ctx, 7, "webauthn"), true);
      assert(Number(ctx.sess.data.core.via.webauthn()) >= before);

      // remember-me is recorded like any other way in — the session rotation drops what preceded it
      assertEquals(await login(ctx, 7, "remember"), true);
      assertEquals(ctx.sess.data.core.via.webauthn(), undefined);
      assert(Number(ctx.sess.data.core.via.remember()) >= before);

      assertEquals(await login(ctx, 7), true); // a caller that says nothing records nothing
      assertEquals(ctx.sess.data.core.via(), undefined);
    });
  } finally {
    await app.db.close();
  }
});
