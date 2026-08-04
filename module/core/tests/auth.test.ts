import { assertEquals, testContext } from "./deps.ts";
import { authListen, login } from "../lib/auth.ts";
import { App, Ctx, requestStorage } from "../mod.ts";

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
