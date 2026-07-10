// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "./deps.ts";
import { authListen } from "../lib/auth.ts";

Deno.test("authListen: login form requires token", async () => {
  const ctx = await testContext({
    sess: { data: { core: { userId: () => 0, csrfToken: () => "good" } } },
    app: { db: { row: () => { throw new Error("auth should not run"); } } },
    set: { post: { core_login: "", email: "u@example.test", pw: "pw", csrfToken: "bad" } },
  });

  await authListen(ctx);
  assertEquals(ctx.loginError, undefined);
});
