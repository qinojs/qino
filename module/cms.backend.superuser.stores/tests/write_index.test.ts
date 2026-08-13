import { assertEquals, assertStringIncludes } from "../../core/tests/deps.ts";
import { toFileUrl } from "@std/path";
import { App } from "../../core/mod.ts";
import { writeIndex } from "../plugin.ts";

/** A folder store with one module, an asset and a suite that must not travel. */
async function fixture() {
  const dir = await Deno.makeTempDir() + "/";
  const mod = dir + "store/t.one/";
  await Deno.mkdir(mod + "pub/", { recursive: true });
  await Deno.mkdir(mod + "tests/", { recursive: true });
  await Deno.writeTextFile(mod + "plugin.ts", "export function init() {}\n");
  await Deno.writeTextFile(mod + "manifest.json", `{\n  "name": "t.one",\n  "description": "One."\n}\n`);
  await Deno.writeTextFile(mod + "pub/main.css", "");
  await Deno.writeTextFile(mod + "tests/one.test.ts", "");
  const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
  return { dir, app, store: app.stores.add(toFileUrl(dir + "store/").href) };
}

Deno.test({
  name: "writeIndex fills every manifest and the catalog, and says when there was nothing to do",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { dir, app, store } = await fixture();

    assertStringIncludes(await writeIndex(store), "t.one");
    const manifest = JSON.parse(await Deno.readTextFile(dir + "store/t.one/manifest.json"));
    assertEquals(manifest.files, ["manifest.json", "plugin.ts", "pub/main.css"], "tests/ stays behind");
    assertEquals(manifest.description, "One.", "other fields are untouched");
    assertEquals(JSON.parse(await Deno.readTextFile(dir + "store/store.json")), { modules: { "t.one": {} } });

    // A local catalog may still name a removed folder. Rewriting follows the folders and keeps
    // metadata of modules that remain instead of trying to enter the stale one.
    await Deno.writeTextFile(dir + "store/store.json", JSON.stringify({ modules: { "t.one": { channel: "dev" }, gone: {} } }));
    const catalogStore = app.stores.add(toFileUrl(dir + "store/store.json").href);
    assertStringIncludes(await writeIndex(catalogStore), "store.json written (1 modules)");
    assertEquals(JSON.parse(await Deno.readTextFile(dir + "store/store.json")), { modules: { "t.one": { channel: "dev" } } });

    assertStringIncludes(await writeIndex(catalogStore), "Nothing to write");

    // A new asset is exactly what the manifest cannot notice by itself.
    await Deno.writeTextFile(dir + "store/t.one/pub/extra.js", "");
    assertStringIncludes(await writeIndex(catalogStore), "1 manifest(s) updated");
    assertEquals(
      JSON.parse(await Deno.readTextFile(dir + "store/t.one/manifest.json")).files,
      ["manifest.json", "plugin.ts", "pub/extra.js", "pub/main.css"],
    );

    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  },
});
