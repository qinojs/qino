import { assertEquals, assertRejects } from "@std/assert";
import { App } from "@qino/qino";
import { file } from "@qino/qino/identity";

import api from "../nodeApi.ts";

async function testApp(): Promise<App> {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("identity");
  await app.init();
  return app;
}

Deno.test("cms.backend.config.identity saves settings and owns its DbFiles", async () => {
  await using app = await testApp();
  const node = { app } as never;
  await api(node, { save: { name: " Portal ", "organization.address.addressCountry": " ch " } });
  assertEquals(await app.settings.identity.name, "Portal");
  assertEquals(await app.settings.identity.organization.address.addressCountry, "CH");
  await assertRejects(() => api(node, { save: { alternateName: "x".repeat(65) } }));

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
});

// identity.file() holds the whole table; a write anywhere has to drop that cache.
Deno.test("cms.backend.config.identity: an uploaded asset shows up right away", async () => {
  await using app = await testApp();
  const node = { app } as never;
  assertEquals(await file(app, "logo"), undefined); // warms the cache while the table is empty

  await api(node, { asset: { name: "logo", dataUrl: "data:image/png;name=logo.png;base64,aGVsbG8=" } });
  assertEquals((await file(app, "logo"))?.name, "logo.png");

  await api(node, { removeAsset: "logo" });
  assertEquals(await file(app, "logo"), undefined);
});
