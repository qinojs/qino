import { App } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";
import { save } from "@qino/qino/home";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("virtual backend offers a provider, applies templates and lists virtual entities escaped", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qino-home-virtual-backend-" });
  const app = new App({ dir, db: "sqlite::memory:" });
  await Deno.writeTextFile(`${dir}/plugin.ts`, `
export const homeProvider = { name: "homeassistant", entities: async () => [], actions: async () => [], call: async () => null };
`);
  app.modules.add(new URL("../../home/plugin.ts", import.meta.url));
  app.modules.add(new URL("../../home.virtual/plugin.ts", import.meta.url));
  app.modules.add(new URL(`file://${dir}/plugin.ts`), "fake.adapter");
  await app.init();
  app.t = fakeT;
  const node = { app, id: 9 } as unknown as Node;
  try {
    assertStringIncludes(String(await cms.node.parts.list(node)), "data-new-provider");
    assertEquals(await cms.node.api(node, { provider: "new" }), { ok: true, message: "Provider saved." });
    const source = await save(app, { name: "<House>", adapter: "homeassistant" });
    const created = await cms.node.api(node, { apply: { template: "android", source, device: "phone", provider: 1 } });
    assertEquals((created as { ok: boolean }).ok, true);
    const output = String(await cms.node.parts.list(node));
    assertStringIncludes(output, "phone Screen brightness");
    assertStringIncludes(output, "&lt;House&gt;");
    assertEquals(output.includes("<House>"), false);
    assertEquals((await cms.node.api(node, { remove: 1 }) as { ok: boolean }).ok, true);
    assertEquals((await cms.node.api(node, { virtual: { provider: source, name: "X" } }) as { ok: boolean }).ok, false);
  } finally {
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
