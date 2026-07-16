// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from "./deps.ts";
import { toFileUrl, $item } from "../../../deps.ts";
import { ModuleManager } from "../lib/ModuleManager.ts";

Deno.test({
  name: "ModuleManager imports modules and initializes by needs",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const root = await Deno.makeTempDir();
    const appPATH = root + "/";
    const localModDir = appPATH + "m/";
    await Deno.mkdir(localModDir + "local.foo/", { recursive: true });
    await Deno.mkdir(appPATH + "private/private.foo/", { recursive: true });
    await Deno.mkdir(appPATH + "private/private.js/", { recursive: true });
    await Deno.mkdir(appPATH + "remote-ish/", { recursive: true });

    await Deno.writeTextFile(localModDir + "local.foo/plugin.ts", `
    export const name = "local.foo";
    export const value = "local";
  `);
    await Deno.writeTextFile(appPATH + "private/private.foo/plugin.ts", `
    export const name = "private.foo";
    export const needs = ["local.foo"];
    export const value = "private";
    export async function install({ app }) {
      app.installed.push(name);
    }
  `);
    await Deno.writeTextFile(appPATH + "remote-ish/plugin.ts", `
    export const name = "remote-ish";
    export const value = "file-url";
  `);
    await Deno.writeTextFile(appPATH + "private/private.js/plugin.js", `
    export const name = "private.js";
    export const value = "js";
  `);

    const app = {
      appPATH,
      db: {},
      installed: [],
      settings: { [$item]: { setSchema() {}, addEventListener() {} } },
    };
    const modules = new ModuleManager(app as any);
    await modules.importAll(toFileUrl(localModDir).href);
    const local = modules.get("local.foo")!;
    assertEquals(local.name, "local.foo");
    assertEquals(local.plugin.value, "local");
    assert(local.path?.endsWith("/local.foo/plugin.ts"));

    await assertRejects(
      () => modules.import("./private/private.foo/"),
      Error,
      "Use app.import(import.meta.resolve",
    );

    const privateModule = await modules.import(toFileUrl(appPATH + "private/private.foo/plugin.ts").href);
    assertEquals(privateModule.name, "private.foo");
    assertEquals(privateModule.plugin.value, "private");
    assert(modules.get("local.foo"));

    const jsModule = await modules.import(toFileUrl(appPATH + "private/private.js/plugin.js").href);
    assertEquals(jsModule.name, "private.js");
    assertEquals(jsModule.plugin.value, "js");

    const fileUrlModule = await modules.import(toFileUrl(appPATH + "remote-ish/plugin.ts").href);
    assertEquals(fileUrlModule.name, "remote-ish");
    assertEquals(fileUrlModule.plugin.value, "file-url");

    assertEquals(modules.get("private.foo")?.plugin.value, "private");
    assert(modules.get("private.foo")?.path?.endsWith("/private.foo/plugin.ts"));
    await modules.init();
    assertEquals(app.installed, ["private.foo"]);

    await Deno.remove(root, { recursive: true });
  },
});

Deno.test("ModuleManager rejects invalid plugins", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(root + "/bad/", { recursive: true });
    await Deno.writeTextFile(root + "/plugin.ts", `export const value = 1;`);
    await Deno.writeTextFile(root + "/bad/plugin.ts", `export const name = "bad.needs"; export const needs = "core";`);

    const modules = new ModuleManager({} as any);
    await assertRejects(
      () => modules.import(toFileUrl(root + "/plugin.ts").href),
      Error,
      "Plugin has no exported name",
    );
    await assertRejects(
      () => modules.import(toFileUrl(root + "/bad/plugin.ts").href),
      Error,
      "exported needs must be an array",
    );
    await assertRejects(
      () => modules.import(toFileUrl(root + "/").href),
      Error,
      "Plugin import needs a file",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ModuleManager init reports missing and circular dependencies", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(root + "/missing/", { recursive: true });
    await Deno.mkdir(root + "/a/", { recursive: true });
    await Deno.mkdir(root + "/b/", { recursive: true });
    await Deno.writeTextFile(root + "/missing/plugin.ts", `
      export const name = "missing.dep";
      export const needs = ["not.imported"];
    `);
    await Deno.writeTextFile(root + "/a/plugin.ts", `
      export const name = "cycle.a";
      export const needs = ["cycle.b"];
    `);
    await Deno.writeTextFile(root + "/b/plugin.ts", `
      export const name = "cycle.b";
      export const needs = ["cycle.a"];
    `);

    const app = {
      settings: { [$item]: { setSchema() {}, addEventListener() {} } },
      fire() {},
      db: {},
    };

    const missing = new ModuleManager(app as any);
    await missing.import(toFileUrl(root + "/missing/plugin.ts").href);
    await assertRejects(
      () => missing.init(),
      Error,
      'Module "missing.dep" needs "not.imported"',
    );

    const cyclic = new ModuleManager(app as any);
    await cyclic.import(toFileUrl(root + "/a/plugin.ts").href);
    await cyclic.import(toFileUrl(root + "/b/plugin.ts").href);
    await assertRejects(
      () => cyclic.init(),
      Error,
      "Circular module dependency",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
