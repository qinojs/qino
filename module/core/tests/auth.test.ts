// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { authListen } from "../lib/auth.ts";
import { RequestContext } from "../lib/RequestContext.ts";

Deno.test("authListen: login form requires token", async () => {
  const ctx = new RequestContext();
  Object.defineProperty(ctx, "post", { value: { liveUser_login: "", email: "u@example.test", pw: "pw", token: "bad" } });
  ctx.sess = { data: { liveUser: () => 0, qg: { token: () => "good" } } } as any;
  ctx.app = { db: { row: () => { throw new Error("auth should not run"); } } } as any;

  await authListen(ctx);
  assertEquals(ctx.loginError, undefined);
});
