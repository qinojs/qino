import { $item, App, Ctx, requestStorage } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

Deno.test("cms.backend.config.webapp: metadata and node API are wired", () => {
  assertEquals(manifest.name, "cms.backend.config.webapp");
  assertEquals(manifest.dependencies, ["webapp", "cms.backend.config", "cms.backend.config.identity"]);
  assertEquals(typeof cms.node.api, "function");
});

Deno.test("cms.backend.config.webapp renders launch and browser settings", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", appPATH: dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("webapp");
  await app.init();
  app.t = fakeT;
  try {
    await app.settings[$item].sub(["identity", "name"]).set("Qino");
    const ctx = await Ctx.create(app, new Request("https://qino.test/"), { appUrl: "/" });
    const node = {
      app,
      cms: { nodeByModule: () => Promise.resolve({ url: () => Promise.resolve("/backend/identity") }) },
    } as never;
    const out = String(await requestStorage.run(ctx, () => cms.node.render(node, { ctx })));
    assertEquals(out.match(/<div class=u2-card/g)?.length, 4);
    assertStringIncludes(out, 'disabled readonly value="Qino"');
    assertEquals(out.includes("Start URL"), false);
    assertEquals(out.includes("<th>Scope"), false);
    assertStringIncludes(out, 'href="/backend/identity"');
    assertStringIncludes(out, "Identity module</a>.");
    assertStringIncludes(out, 'href="/manifest.webmanifest"');
    assertStringIncludes(out, 'name="display"');
    assertStringIncludes(out, 'name="categories"');
    assertStringIncludes(out, 'name="telephoneDetection"');
    assertEquals(out.includes('name="appleMobileWebAppCapable"'), false);
    assertEquals(out.match(/data-status(?=[\s>])/g)?.length, 3);
    assertStringIncludes(out, "<iframe data-webapp-preview");
    assertStringIncludes(out, "sandbox=allow-same-origin");
    assertStringIncludes(out, "data-webapp-scene=home");
    assertStringIncludes(out, "data-webapp-scene=splash");
    assertStringIncludes(out, "data-webapp-scene=page");
    assertStringIncludes(out, "for=preview-home");
    assertStringIncludes(out, "for=preview-starts");
    assertStringIncludes(out, "for=preview-loaded");
    assertStringIncludes(out, "height:65rem");
    assertEquals(out.match(/data-webapp-time/g)?.length, 3);
    assertStringIncludes(out, "+41 44 123 45 67");
  } finally {
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
