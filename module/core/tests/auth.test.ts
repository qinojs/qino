import { assert, assertEquals, assertRejects, testContext } from "./deps.ts";
import { beforeProof, login, loginFromRequest, loginProof, pendingLogin, proofFailed, pwHash, tryLogin } from "../lib/auth/mod.ts";
import { App, Ctx, requestStorage, unixTime } from "../mod.ts";

Deno.test("loginFromRequest: login form requires token", async () => {
  const ctx = await testContext({
    sess: { data: { core: { userId: () => 0, csrfToken: () => "good" } } },
    app: { db: { row: () => { throw new Error("auth should not run"); } } },
    set: { post: { core_login: "", email: "u@example.test", pw: "pw", csrfToken: "bad" } },
  });

  await loginFromRequest(ctx);
  assertEquals(ctx.loginError, undefined);
});

Deno.test("loginFromRequest: login form requires POST", async () => {
  const ctx = await testContext({
    method: "PUT",
    sess: { data: { core: { userId: () => 0, csrfToken: () => "good" } } },
    app: { db: { row: () => { throw new Error("auth should not run"); } } },
    set: { post: { core_login: "", email: "u@example.test", pw: "pw", csrfToken: "good" } },
  });

  await loginFromRequest(ctx);
  assertEquals(ctx.loginError, undefined);
});

/** A real app and a request in it. Session writes are fire-and-forget, so they are given the tick
 *  they need before the database goes away — otherwise they land on a closed connection. */
async function withApp(fn: (app: App, ctx: Ctx) => Promise<void>) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json"));
  await app.init();
  try {
    await app.db.table("usr").insert({ id: 7, email: "ann@example.test", active: true });
    await app.db.table("client").insert({ id: 1 });
    const ctx = await Ctx.create(app, new Request("http://test/"), { appUrl: "/" });
    ctx.clientId = "1";
    await requestStorage.run(ctx, () => fn(app, ctx));
  } finally {
    await new Promise((r) => setTimeout(r));
    await app.db.close();
  }
}

// logout() empties the very item login() hands to the listeners, so what they get has to be a
// snapshot — otherwise a module carrying something over the login (a shop cart) finds it gone.
Deno.test("login: auth:login carries the session as it was before the logout", async () => {
  await withApp(async (app, ctx) => {
    let seen: Record<string, any> | undefined;
    app.on("auth:login", (e) => { seen = e.oldSession; });
    ctx.sess.data.shp3.cartId("42");

    assertEquals(await login(ctx, 7), true);
    assertEquals(seen?.shp3?.cartId, "42");
    assertEquals(ctx.sess.data.shp3.cartId(), undefined); // the new session starts empty
  });
});

/** Declare factors on a running app, the way a linked module's plugin would. */
// deno-lint-ignore no-explicit-any
function linkFactors(app: App, authFactors: any[]) {
  const linked = app.modules.linked();
  // deno-lint-ignore no-explicit-any
  (app.modules as any).linked = () => [...linked, { name: "auth.fake", plugin: { authFactors } }];
}

const totp = { name: "totp", label: "Authenticator app", stepUp: true, has: () => Promise.resolve(true) };

Deno.test("login: a second factor asked for parks the login instead of opening a session", async () => {
  await withApp(async (app, ctx) => {
    await app.db.table("usr").update(7, { pw: await pwHash("secret") });
    await app.settings.core.loginTwoFactor(true);
    linkFactors(app, [totp]);

    assertEquals(await tryLogin(ctx, "ann@example.test", "secret"), "pending");
    assertEquals(ctx.userId, 0); // the password was right and still opens nothing
    assertEquals(pendingLogin(ctx)?.usrId, 7);
    assert(pendingLogin(ctx)?.via.password);

    // the second factor finds the login under way and finishes it
    assertEquals(await loginProof(ctx, totp, 7), undefined);
    assertEquals(ctx.userId, 7);
    assert(Number(ctx.sess.data.core.via.password()) > 0); // both are recorded, each with its own moment
    assert(Number(ctx.sess.data.core.via.totp()) > 0);
    assertEquals(pendingLogin(ctx), undefined); // the rotation took the half login with it
  });
});

Deno.test("login: whoever has no second factor is let in with one — a demand nobody can meet is no protection", async () => {
  await withApp(async (app, ctx) => {
    await app.db.table("usr").update(7, { pw: await pwHash("secret") });
    await app.settings.core.loginTwoFactor(true);
    linkFactors(app, [{ ...totp, has: () => Promise.resolve(false) }]);

    assertEquals(await tryLogin(ctx, "ann@example.test", "secret"), "");
    assertEquals(ctx.userId, 7);
  });
});

Deno.test("login: wrong passwords buy a growing wait that every factor shares", async () => {
  await withApp(async (app, ctx) => {
    await app.db.table("usr").update(7, { pw: await pwHash("secret") });

    for (let i = 0; i < 4; i++) assertEquals(await tryLogin(ctx, "ann@example.test", "wrong"), "password");
    // the fifth is not checked at all — and the right password has to sit out what the wrong ones earned
    assertEquals(await tryLogin(ctx, "ann@example.test", "secret"), "throttled");
    assertEquals(ctx.userId, 0);
    // the same wait stands in front of every other factor: nobody gets a fresh budget by switching
    await assertRejects(() => beforeProof(app, 7), Error, "Too many attempts");
  });
});

Deno.test("login: a half login does not wipe the wait — a known password buys no fresh guesses", async () => {
  await withApp(async (app, ctx) => {
    await app.db.table("usr").update(7, { pw: await pwHash("secret") });
    await app.settings.core.loginTwoFactor(true);
    linkFactors(app, [totp]);

    assertEquals(await tryLogin(ctx, "ann@example.test", "secret"), "pending");
    for (let i = 0; i < 4; i++) await proofFailed(app, 7); // guesses at the second factor

    // typing the right password again settles nothing: the login it belongs to never finished
    assertEquals(await tryLogin(ctx, "ann@example.test", "secret"), "throttled");
    await assertRejects(() => beforeProof(app, 7), Error, "Too many attempts");
  });
});

Deno.test("login: the pass a lapsed session makes costs the account nothing", async () => {
  await withApp(async (app, ctx) => {
    await app.db.table("usr").update(7, { pw: await pwHash("secret") });
    // what loginFromRequest does on every request of a client that is signed in nowhere
    for (let i = 0; i < 9; i++) assertEquals(await tryLogin(ctx, "ann@example.test"), "password");
    await beforeProof(app, 7); // nothing was typed, so nothing was guessed
    assertEquals(await tryLogin(ctx, "ann@example.test", "secret"), "");
  });
});

Deno.test("login: a proof that lands wipes the wait", async () => {
  await withApp(async (app, ctx) => {
    await app.db.table("usr").update(7, { pw: await pwHash("secret") });
    for (let i = 0; i < 3; i++) assertEquals(await tryLogin(ctx, "ann@example.test", "wrong"), "password");
    assertEquals(await tryLogin(ctx, "ann@example.test", "secret"), "");
    await beforeProof(app, 7); // whoever got in was not the one being kept out
  });
});

Deno.test("login: how the identity was had is recorded, and the rotation drops it", async () => {
  await withApp(async (_app, ctx) => {
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
});
