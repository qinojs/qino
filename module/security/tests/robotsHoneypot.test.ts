import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { reports, suspects } from "../mod.ts";
import { close, from, testApp } from "./app.ts";

Deno.test("security: robots.txt disallows the trap, requesting it reports weight 3", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = await testApp(dir);
  try {
    const robots = await (await app.fetch(new Request("https://qino.test/site/robots.txt"), from("1.1.1.1"))).text();
    assertStringIncludes(robots, "Disallow: /site/admin-backup/\n");
    assertEquals(reports(app), []);

    await app.fetch(new Request("https://qino.test/site/admin-backup/secret.zip"), from("6.6.6.6"));
    assertEquals(reports(app).map((r) => [r.ip, r.weight, r.reason]), [["6.6.6.6", 3, "robots.txt honeypot"]]);
    assertEquals(Math.round(suspects(app)[0].strength), 3);
  } finally {
    await close(app);
    await Deno.remove(dir, { recursive: true });
  }
});
