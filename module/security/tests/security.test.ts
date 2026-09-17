import { App } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import type { Ctx } from "@qino/qino";

const from = (hostname: string) => ({ remoteAddr: { hostname } });

Deno.test("security blocks reported IPs and sets a robots.txt honeypot", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir, appUrl: "/site/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("seo").add("security");
  await app.init();
  try {
    const robots = await (await app.fetch(new Request("https://qino.test/site/robots.txt"), from("1.1.1.1"))).text();
    assertStringIncludes(robots, "Disallow: /site/admin-backup/\n");

    await app.fetch(new Request("https://qino.test/site/admin-backup/"), from("6.6.6.6"));
    const ctx = { app, req: { clientIp: "6.6.6.6" } } as unknown as Ctx;
    await app.fire("suspicious", { ctx, weight: 48 }); // 3 + 48 = 51: blocked, other IPs are not
    const res = await app.fetch(new Request("https://qino.test/site/robots.txt"), from("6.6.6.6"));
    assertEquals(res.status, 429);
    assertEquals(Number(res.headers.get("retry-after")) > 0, true);
    assertEquals((await app.fetch(new Request("https://qino.test/site/robots.txt"), from("1.1.1.1"))).status, 200);

    const stored = await app.db.one`SELECT COUNT(*) FROM score s JOIN log_ip l ON l.id = s.id WHERE l.ip = ${"6.6.6.6"}`;
    assertEquals(Number(stored), 1);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
