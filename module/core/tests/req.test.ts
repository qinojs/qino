import { assertEquals } from "./deps.ts";
import { parseCookies } from "../lib/Req.ts";

Deno.test("parseCookies keeps the first cookie when paths provide duplicate names", () => {
  assertEquals(parseCookies("qgSession=cms1; qgSession=root; cid=client"), {
    qgSession: "cms1",
    cid: "client",
  });
});
