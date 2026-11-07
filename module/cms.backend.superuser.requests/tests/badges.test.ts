import { test } from "node:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { App, Ctx, fs, requestStorage } from "@qino/qino";
import { geoip } from "@qino/qino/locale.geoip";

import { ipBadges } from "../mod.ts";

test("backend.requests: an IP shows its country once locale.geoip is there", async () => {
  await using app = new App({ db: "sqlite::memory:", dir: await fs.tempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cron").add("locale.geoip");
  await app.init();
  const dir = `${app.dir}cache/locale.geoip/dbip/`;
  await fs.mkdir(dir);
  await fs.write(dir + "dbip.csv.gz", await new Response(new Blob(["1.0.0.0,1.0.0.255,AU\n"]).stream().pipeThrough(new CompressionStream("gzip"))).bytes());
  for (let i = 0; i < 100 && !await geoip.size(app); i++) await geoip.lookup(app).then(() => new Promise((r) => setTimeout(r, 10)));

  const ctx = await Ctx.create(app, new Request("http://test/"), { appUrl: "/" });
  await requestStorage.run(ctx, async () => {
    const badges = await ipBadges(app);
    assertStringIncludes(String(badges("1.0.0.7")), "<small class=u2-badge>AU</small>");
    assertStringIncludes(String(badges("1.0.0.X")), ">AU<"); // anonymized, same block
    assertEquals(String(badges("8.8.8.8")).includes("u2-badge"), false);
  });
});
