import { test } from "node:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { App, Ctx, fs, requestStorage } from "@qino/qino";

import nodeApi from "../nodeApi.ts";
import { cms as panel } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

async function app_() {
  const app = new App({ db: "sqlite::memory:", dir: await fs.tempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cron").add("locale.geoip");
  await app.init();
  return app;
}

const call = (app: App, vars: Record<string, unknown>, access = 2) =>
  nodeApi({ access: () => Promise.resolve(access), app } as unknown as Node, vars);

test("backend.locale.geoip: the source is switched from here", async () => {
  await using app = await app_();
  assertEquals(String(await app.settings["locale.geoip"].source), "dbip");
  assertEquals(await call(app, { source: "rir" }), { source: "rir" });
  assertEquals(String(await app.settings["locale.geoip"].source), "rir");

  assertEquals(await call(app, { source: "other" }), false); // not a source
  assertEquals(await call(app, { source: "dbip" }, 1), false); // read access only
  assertEquals(await call(app, { now: 1 }, 1), false);
  assertEquals(await call(app, { nonsense: 1 }), false);
  assertEquals(String(await app.settings["locale.geoip"].source), "rir");
});

test("backend.locale.geoip: the panel shows source, state and the own address", async () => {
  await using app = await app_();
  // a fetched file, so opening the panel does not reach outside
  const dir = `${app.dir}cache/locale.geoip/dbip/`;
  await fs.mkdir(dir);
  await fs.write(dir + "dbip.csv.gz", await new Response(new Blob(["1.0.0.0,1.0.0.255,AU\n"]).stream().pipeThrough(new CompressionStream("gzip"))).bytes());
  const ctx = await Ctx.create(app, new Request("http://test/"), { appUrl: "/" });
  ctx.sess = await app.sessions.load();
  await requestStorage.run(ctx, async () => {
    const html = String(await panel.node.render({ app } as unknown as Node));
    assertEquals(html.includes("[object Promise]"), false);
    assertStringIncludes(html, "<option value=dbip selected>DB-IP Lite");
    assertStringIncludes(html, "db-ip.com");
    assertStringIncludes(html, "last ");
    assertStringIncludes(html, "Loading…"); // the render started the load
    assertStringIncludes(html, "<form class=-test>");
  });

  // the test field: a code once loaded, null for what no range knows
  let res;
  for (let i = 0; i < 100 && !(res as { country?: string })?.country; i++) {
    res = await new Promise((r) => setTimeout(r, 10)).then(() => call(app, { ip: " 1.0.0.1 " }));
  }
  assertEquals(res, { country: "AU" });
  assertEquals(await call(app, { ip: "127.0.0.1" }), { country: null });
  assertEquals(await call(app, { ip: "1.0.0.1" }, 1), false); // read access only
  await requestStorage.run(ctx, async () => {
    assertStringIncludes(String(await panel.node.render({ app } as unknown as Node)), "Loaded: 0k IPv4, 0k IPv6 ranges");
  });
});
