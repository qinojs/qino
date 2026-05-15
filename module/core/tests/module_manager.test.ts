// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects, toFileUrl, $item } from "../../../deps.ts";
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

    await Deno.writeTextFile(localModDir + "local.foo/mod.ts", `
    export const name = "local.foo";
    export const value = "local";
  `);
    await Deno.writeTextFile(appPATH + "private/private.foo/mod.ts", `
    export const name = "private.foo";
    export const needs = ["local.foo"];
    export const value = "private";
    export async function install({ app }) {
      app.installed.push(name);
    }
  `);
    await Deno.writeTextFile(appPATH + "remote-ish/mod.ts", `
    export const name = "remote-ish";
    export const value = "file-url";
  `);
    await Deno.writeTextFile(appPATH + "private/private.js/mod.js", `
    export const name = "private.js";
    export const value = "js";
  `);

    const events: string[] = [];
    const app = {
      appPATH,
      db: {},
      installed: [],
      settings: { [$item]: { setSchema() {} } },
      fire: (event: string) => {
        events.push(event);
      },
    };
    const modules = new ModuleManager(app as any);
    await modules.importAll(toFileUrl(localModDir).href);
    const local = modules.get("local.foo")!;
    assertEquals(local.name, "local.foo");
    assertEquals(local.exports.value, "local");
    assert(local.path?.endsWith("/local.foo/mod.ts"));

    await assertRejects(
      () => modules.import("./private/private.foo/"),
      Error,
      "Use app.import(import.meta.resolve",
    );

    const privateModule = await modules.import(toFileUrl(appPATH + "private/private.foo/mod.ts").href);
    assertEquals(privateModule.name, "private.foo");
    assertEquals(privateModule.exports.value, "private");
    assert(modules.get("local.foo"));

    const jsModule = await modules.import(toFileUrl(appPATH + "private/private.js/mod.js").href);
    assertEquals(jsModule.name, "private.js");
    assertEquals(jsModule.exports.value, "js");

    const fileUrlModule = await modules.import(toFileUrl(appPATH + "remote-ish/mod.ts").href);
    assertEquals(fileUrlModule.name, "remote-ish");
    assertEquals(fileUrlModule.exports.value, "file-url");

    assertEquals(modules.get("private.foo")?.exports.value, "private");
    assert(modules.get("private.foo")?.path?.endsWith("/private.foo/mod.ts"));
    await modules.init();
    assertEquals(events, ["init"]);
    assertEquals(app.installed, ["private.foo"]);

    await Deno.remove(root, { recursive: true });
  },
});

Deno.test("ModuleManager rejects invalid module exports", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(root + "/no-name.ts", `export const value = 1;`);
    await Deno.writeTextFile(root + "/bad-needs.ts", `export const name = "bad.needs"; export const needs = "core";`);

    const modules = new ModuleManager({} as any);
    await assertRejects(
      () => modules.import(toFileUrl(root + "/no-name.ts").href),
      Error,
      "Module has no exported name",
    );
    await assertRejects(
      () => modules.import(toFileUrl(root + "/bad-needs.ts").href),
      Error,
      "exported needs must be an array",
    );
    await assertRejects(
      () => modules.import(toFileUrl(root + "/").href),
      Error,
      "Module import needs a file",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ModuleManager init reports missing and circular dependencies", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(root + "/missing.ts", `
      export const name = "missing.dep";
      export const needs = ["not.imported"];
    `);
    await Deno.writeTextFile(root + "/a.ts", `
      export const name = "cycle.a";
      export const needs = ["cycle.b"];
    `);
    await Deno.writeTextFile(root + "/b.ts", `
      export const name = "cycle.b";
      export const needs = ["cycle.a"];
    `);

    const app = {
      settings: { [$item]: { setSchema() {} } },
      fire() {},
      db: {},
    };

    const missing = new ModuleManager(app as any);
    await missing.import(toFileUrl(root + "/missing.ts").href);
    await assertRejects(
      () => missing.init(),
      Error,
      'Module "missing.dep" needs "not.imported"',
    );

    const cyclic = new ModuleManager(app as any);
    await cyclic.import(toFileUrl(root + "/a.ts").href);
    await cyclic.import(toFileUrl(root + "/b.ts").href);
    await assertRejects(
      () => cyclic.init(),
      Error,
      "Circular module dependency",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
