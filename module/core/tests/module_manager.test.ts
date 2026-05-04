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
