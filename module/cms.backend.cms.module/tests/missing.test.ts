import { App, runAs } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";
import { assert, assertStringIncludes } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.backend.cms.module: modules nodes name but nothing renders are listed and marked", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  for (const mod of ["cms", "cms.cont.text"]) app.modules.add(new URL(`../../${mod}/plugin.ts`, import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true, superuser: true });
    await app.db.table("page").insert({ id: 901, basis: 0, type: "c", module: "cms.cont.gone2" });
    const node = { app, cms: cmsOf(app) } as unknown as Node;
    Object.defineProperty(app, "t", { value: (s: TemplateStringsArray, ...v: unknown[]) => Promise.resolve(String.raw(s, ...v)) });
    const render = (vars = {}) => runAs(app, 7, "test", () => cms.node.render(node, { vars })).then(String);

    const overview = await render();
    assertStringIncludes(overview, "cms.cont.gone2</a> <small>missing</small>");
    assertStringIncludes(overview, "<u2-ico icon=warning");
    assert(!overview.includes("cms.cont.text</a> <small>"), "a module that renders is not marked");
    assertStringIncludes(await render({ mod: "cms.cont.gone2" }), "<small>missing</small>");
    assertStringIncludes(await render({ mod: "cms.cont.unused9" }), "not found.");
  } finally {
    await app.db.close();
  }
});
