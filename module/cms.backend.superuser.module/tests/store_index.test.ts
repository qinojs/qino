import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { assertEquals, assertRejects, assertStringIncludes } from "@qino/qino/tests";
import { App, fs } from "@qino/qino";

import { writeIndex } from "../storeIndex.ts";

/** A folder store with one module, an asset and a suite that must not travel. */
async function fixture() {
  const dir = await fs.tempDir() + "/";
  const mod = dir + "store/t.one/";
  await fs.mkdir(mod + "pub/");
  await fs.mkdir(mod + "tests/");
  await fs.write(mod + "plugin.ts", "export function init() {}\n");
  await fs.write(mod + "manifest.json", `{\n  "name": "t.one",\n  "description": "One."\n}\n`);
  await fs.write(mod + "pub/main.css", "");
  await fs.write(mod + "tests/one.test.ts", "");
  const app = new App({ dir, db: `sqlite:${dir}test.sqlite` });
  return { dir, app, store: app.stores.add(pathToFileURL(dir + "store/").href) };
}

test("writeIndex fills every manifest and the catalog, and says when there was nothing to do", async () => {
  const { dir, app, store } = await fixture();

  assertStringIncludes(await writeIndex(store), "t.one");
  const manifest = JSON.parse(await fs.text(dir + "store/t.one/manifest.json"));
  assertEquals(manifest.files, ["manifest.json", "plugin.ts", "pub/main.css"], "tests/ stays behind");
  assertEquals(manifest.description, "One.", "other fields are untouched");
  assertEquals(JSON.parse(await fs.text(dir + "store/store.json")), { modules: { "t.one": {} } });

  // A local catalog may still name a removed folder. Rewriting follows the folders and keeps
  // metadata of modules that remain instead of trying to enter the stale one.
  await fs.write(dir + "store/store.json", JSON.stringify({ modules: { "t.one": { channel: "dev" }, gone: {} } }));
  const catalogStore = app.stores.add(pathToFileURL(dir + "store/store.json").href);
  assertStringIncludes(await writeIndex(catalogStore), "store.json written (1 modules)");
  assertEquals(JSON.parse(await fs.text(dir + "store/store.json")), { modules: { "t.one": { channel: "dev" } } });

  assertStringIncludes(await writeIndex(catalogStore), "Nothing to write");

  // A new asset is exactly what the manifest cannot notice by itself.
  await fs.write(dir + "store/t.one/pub/extra.js", "");
  assertStringIncludes(await writeIndex(catalogStore), "1 manifest(s) updated");
  assertEquals(
    JSON.parse(await fs.text(dir + "store/t.one/manifest.json")).files,
    ["manifest.json", "plugin.ts", "pub/extra.js", "pub/main.css"],
  );

  await fs.write(dir + "store/t.one/manifest.json", "{");
  await assertRejects(() => writeIndex(catalogStore), SyntaxError);
  assertEquals(await fs.text(dir + "store/t.one/manifest.json"), "{", "a broken manifest is not overwritten");

  await app.db.close();
  await fs.remove(dir, { recursive: true });
});
