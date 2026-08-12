import { assertEquals } from "@std/assert";
import { $item, App } from "../../core/mod.ts";
import api from "../nodeApi.ts";

async function testApp(): Promise<App> {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("identity");
  await app.init();
  return app;
}

Deno.test("cms.backend.config.identity saves settings and owns its DbFiles", async () => {
  const app = await testApp();
  const node = { app } as never;
  try {
    await api(node, { save: { name: " Portal ", "organization.address.addressCountry": " ch " } });
    assertEquals(await app.settings[$item].sub(["identity", "name"]).proxy, "Portal");
    assertEquals(await app.settings.identity.organization.address.addressCountry, "CH");

    await api(node, { asset: { name: "logo", dataUrl: "data:image/png;name=logo.png;base64,aGVsbG8=" } });
    const first = Number(await app.db.one`SELECT file_id FROM identity_file WHERE name = ${"logo"}`);
    assertEquals(await app.db.one`SELECT access FROM file WHERE id = ${first}`, 1);

    await api(node, { asset: { name: "logo", dataUrl: "data:image/png;name=other.png;base64,d29ybGQ=" } });
    const second = Number(await app.db.one`SELECT file_id FROM identity_file WHERE name = ${"logo"}`);
    assertEquals(second !== first, true);
    assertEquals(await app.db.one`SELECT id FROM file WHERE id = ${first}`, undefined);

    await api(node, { asset: { name: "font", dataUrl: "data:font/woff2;name=brand.woff2;base64,aGVsbG8=" } });
    assertEquals(Number(await app.db.one`SELECT file_id FROM identity_file WHERE name = ${"font"}`) > 0, true);

    await api(node, { removeAsset: "logo" });
    assertEquals(await app.db.one`SELECT file_id FROM identity_file WHERE name = ${"logo"}`, undefined);
    assertEquals(await app.db.one`SELECT id FROM file WHERE id = ${second}`, undefined);
  } finally {
    await app.db.close();
  }
});
