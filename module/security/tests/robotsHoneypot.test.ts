import { assert, assertEquals } from "@qino/qino/tests";

import { reports, suspects } from "../mod.ts";
import { get, withApp } from "./app.ts";

Deno.test("security: robots.txt disallows a trap, requesting it reports weight 10", () => withApp(async (app) => {
  const robots = await (await get(app, "1.1.1.1")).text();
  const trap = robots.match(/^Disallow: \/site\/(.+)$/m)?.[1] ?? "";
  assert(/^[\w-]{8}\/$/.test(trap), trap);
  assertEquals(reports(app), []);

  await get(app, "6.6.6.6", `${trap}secret.zip`);
  assertEquals(reports(app).map((r) => [r.ip, r.weight, r.reason]), [["6.6.6.6", 10, "robots.txt honeypot"]]);
  assertEquals(Math.round(suspects(app)[0].strength), 10);
}));
