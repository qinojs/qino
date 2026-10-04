import { App, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";
import { series } from "@qino/qino/home.record";

import backendApi from "../nodeApi.ts";
import { list } from "../render.ts";

import type { Node } from "@qino/qino/cms";

async function fixture() {
  const dir = await Deno.makeTempDir(), app = new App({ dir, db: "sqlite::memory:" });
  for (const name of ["home", "home.history", "cron", "home.record"]) app.modules.add(new URL(`../../${name}/plugin.ts`, import.meta.url));
  await app.init();
  return { app, close: async () => { await app.modules.unlink("home.record"); await app.modules.unlink("cron"); await app.db.close(); await Deno.remove(dir, { recursive: true }); } };
}

Deno.test("home backend can select and stop disconnected recordings through the protected API", async () => {
  const { app, close } = await fixture(), node = { app } as Node;
  try {
    app.t = fakeT;
    const user = await testContext({ app, set: { user: { id: 7 } } });
    await requestStorage.run(user, async () => {
      assertEquals(await backendApi(node, { record: { provider: "offline", entity: "<meter>", enabled: true } }), { ok: true, message: "Recording updated." });
      const output = String(await list(node));
      assertStringIncludes(output, "Local recordings");
      assertStringIncludes(output, "&lt;meter&gt;");
      assertStringIncludes(output, "checked");
      assertEquals(await backendApi(node, { record: { provider: "offline", entity: "<meter>", enabled: false } }), { ok: true, message: "Recording updated." });
      assertEquals((await series(app))[0].enabled, false);
      assertEquals((await backendApi(node, { record: { provider: "offline", entity: "<meter>", enabled: "false" } }) as { ok: boolean }).ok, false);
    });
    const guest = await testContext({ app });
    await requestStorage.run(guest, async () => {
      assertEquals(await backendApi(node, { record: { provider: "offline", entity: "<meter>", enabled: true } }), { ok: false, message: "Access denied" });
      assertEquals((await series(app))[0].enabled, false);
    });
  } finally { await close(); }
});

