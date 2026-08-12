import { assertEquals, assertStringIncludes, fakeT } from "../../core/tests/deps.ts";
import { App } from "../../core/mod.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

Deno.test("cms.backend.config.identity: metadata and node API are wired", () => {
  assertEquals(manifest.name, "cms.backend.config.identity");
  assertEquals(manifest.dependencies, ["identity", "cms.backend.config"]);
  assertEquals(typeof cms.node.api, "function");
});

Deno.test("cms.backend.config.identity: render exposes the canonical fields and assets", async () => {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("identity");
  await app.init();
  app.t = fakeT;
  try {
    const out = String(await cms.node.render({ app } as never));
    assertStringIncludes(out, "data-identity");
    assertEquals(out.match(/<form class=u2-card data-identity/g)?.length, 5);
    assertStringIncludes(out, 'name="organization.address.streetAddress"');
    assertStringIncludes(out, 'name="contact.telephone"');
    assertStringIncludes(out, 'name="brand.primaryColor"');
    assertStringIncludes(out, 'name="brand.fontFamily"');
    assertStringIncludes(out, "data-asset=logo");
    assertStringIncludes(out, "data-asset=icon");
    assertStringIncludes(out, "data-asset=font");
  } finally {
    await app.db.close();
  }
});
