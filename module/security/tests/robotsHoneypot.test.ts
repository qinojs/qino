import { assert, assertEquals } from "@qino/qino/tests";

import { reports, suspects } from "../mod.ts";
import { close, from, testApp } from "./app.ts";

import type { App } from "@qino/qino";

const trapOf = async (app: App) => {
  const robots = await (await app.fetch(new Request("https://qino.test/site/robots.txt"), from("1.1.1.1"))).text();
  return robots.match(/^Disallow: \/site\/(.+)$/m)?.[1] ?? "";
};

Deno.test("security: robots.txt disallows a trap, requesting it reports weight 20", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = await testApp(dir);
  try {
    const trap = await trapOf(app);
    assert(/^[\w-]{8}\/$/.test(trap), trap);
    assertEquals(reports(app), []);

    await app.fetch(new Request(`https://qino.test/site/${trap}secret.zip`), from("6.6.6.6"));
    assertEquals(reports(app).map((r) => [r.ip, r.weight, r.reason]), [["6.6.6.6", 20, "robots.txt honeypot"]]);
    assertEquals(Math.round(suspects(app)[0].strength), 20);
  } finally {
    await close(app);
    await Deno.remove(dir, { recursive: true });
  }
});
