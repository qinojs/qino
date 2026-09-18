// deno-lint-ignore-file no-explicit-any
import { $item, bildJsonItem, enableItemSchemaDefaults } from "@qino/qino";
import { cmsCtx } from "@qino/qino/cms";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

Deno.test("cms.cont.nav3: invalid start pages fall back without querying an invalid id", async () => {
  const ctx = await testContext();
  for (const value of [undefined, null, "", "invalid", "NaN", {}, -1, 0, 1.5, "Infinity", "9007199254740992", 42, "42"]) {
    const settings = bildJsonItem(JSON.stringify({ startPage: value }), () => {}).proxy;
    settings[$item].setSchema(cms.node.settingsSchema);
    enableItemSchemaDefaults(settings[$item]);
    const queried: number[] = [];
    let rendered = 0;
    const page = (id: number) => ({
      exists: () => true,
      children: () => { rendered = id; return new Map(); },
    });
    const current = page(7);
    cmsCtx(ctx).mainNode = current as any;
    const node = {
      settings,
      page: () => current,
      cms: { node: (id: number) => { queried.push(id); return page(id); } },
    };
    assertEquals(await cms.node.render(node as any, { ctx }), "<nav></nav>");
    const valid = value === 42 || value === "42";
    assertEquals(queried, valid ? [42] : []);
    assertEquals(rendered, valid ? 42 : 7);
  }
});
