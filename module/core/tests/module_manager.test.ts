// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from "./deps.ts";
import { toFileUrl, $item } from "../deps.ts";
import { ModuleManager } from "../lib/ModuleManager.ts";
import { StoreManager } from "../lib/StoreManager.ts";
import { Emitter } from "../lib/Emitter.ts";

// The managers read their `module` and `store` rows on init; these tests have no database.
const fakeDb = () => ({
  query: () => Promise.resolve([]),
  table: () => ({ ensure: () => Promise.resolve(), delete: () => Promise.resolve() }),
});

Deno.test({
  name: "ModuleManager imports modules and initializes by dependencies",
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
    export const value = "local";
  `);
    await Deno.writeTextFile(appPATH + "private/private.foo/plugin.ts", `
    export const value = "private";
    export async function install({ app }) {
      app.installed.push("private.foo");
    }
  `);
    await Deno.writeTextFile(appPATH + "private/private.foo/manifest.json", `{ "name": "private.foo", "dependencies": ["local.foo"] }`);
    await Deno.writeTextFile(appPATH + "remote-ish/plugin.ts", `
    export const value = "file-url";
  `);
    await Deno.writeTextFile(appPATH + "remote-ish/manifest.json", `{ "name": "remote-ish" }`);
    await Deno.writeTextFile(appPATH + "private/private.js/plugin.js", `
    export const value = "js";
  `);
    await Deno.writeTextFile(appPATH + "private/private.js/manifest.json", `{ "name": "private.js" }`);

    const app = {
      appPATH,
      db: fakeDb(),
      installed: [],
      settings: { [$item]: { setSchema() {}, addEventListener() {} } },
    };
    const modules = new ModuleManager(app as any);
    const local = await modules.import(toFileUrl(localModDir + "local.foo/plugin.ts").href);
    assertEquals(local.name, "local.foo");
    assertEquals(local.plugin.value, "local");
    assert(local.source.endsWith("/local.foo/plugin.ts"));

    await assertRejects(
      () => modules.import("./private/private.foo/"),
      Error,
      "Use app.modules.add",
    );

    assertEquals(local.data,  appPATH + "data/local.foo/");
    assertEquals(local.cache, appPATH + "cache/local.foo/");
    assertEquals(local.tmp,   appPATH + "tmp/local.foo/");

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
    assert(modules.get("private.foo")?.source.endsWith("/private.foo/plugin.ts"));
    await modules.init();
    assertEquals(app.installed, ["private.foo"]);

    await Deno.remove(root, { recursive: true });
  },
});

Deno.test({
  name: "ModuleManager unlink tears down signal-bound listeners; re-link rebinds",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const root = await Deno.makeTempDir();
    const modDir = root + "/m/";
    await Deno.mkdir(modDir + "sig.foo/", { recursive: true });
    // init() registers a listener bound to the per-module signal
    await Deno.writeTextFile(modDir + "sig.foo/plugin.ts", `
      export function init(app, { signal }) {
        app.on("ping", (e) => { e.count++; }, { signal });
      }
    `);

    const bus = new Emitter<{ ping: { count: number } }>();
    const app = {
      appPATH: root + "/",
      db: fakeDb(),
      apiTree: {} as Record<string, unknown>,
      settings: { [$item]: { setSchema() {}, addEventListener() {} } },
      on: bus.on.bind(bus),
      fire: bus.fire.bind(bus),
    };

    const modules = new ModuleManager(app as any);
    modules.add("./m/sig.foo/plugin.ts");
    await modules.init();
    assertEquals((await app.fire("ping", { count: 0 })).count, 1); // linked → handler runs

    modules.unlink("sig.foo");
    assertEquals((await app.fire("ping", { count: 0 })).count, 0); // unlinked → signal aborted, listener gone

    await modules.link("sig.foo");
    assertEquals((await app.fire("ping", { count: 0 })).count, 1); // re-linked → fresh signal rebinds

    await Deno.remove(root, { recursive: true });
  },
});

Deno.test("ModuleManager rejects invalid plugins", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(root + "/bad/", { recursive: true });
    await Deno.writeTextFile(root + "/plugin.ts", `export function init() {}`);
    await Deno.writeTextFile(root + "/manifest.json", `{ "name": 1 }`);
    await Deno.writeTextFile(root + "/bad/plugin.ts", `export function init() {}`);
    await Deno.writeTextFile(root + "/bad/manifest.json", `{ "name": "bad.dependencies", "dependencies": "core" }`);

    const modules = new ModuleManager({} as any);
    await assertRejects(
      () => modules.import(toFileUrl(root + "/plugin.ts").href),
      Error,
      "has an invalid name",
    );
    await assertRejects(
      () => modules.import(toFileUrl(root + "/bad/plugin.ts").href),
      Error,
      "dependencies must be an array",
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

Deno.test("Store selects modules by directory name", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(root + "/hello.world/", { recursive: true });
    await Deno.mkdir(root + "/hello.analytics/", { recursive: true });
    await Deno.writeTextFile(root + "/store.json", JSON.stringify({
      modules: {
        "hello.world": {},
        "hello.analytics": {},
      },
    }));
    await Deno.writeTextFile(root + "/hello.world/plugin.ts", `
      export function init(app) { app.loaded.push("hello.world"); }
    `);
    await Deno.writeTextFile(root + "/hello.analytics/plugin.ts", `
      export function init(app) { app.loaded.push("hello.analytics"); }
    `);

    const createApp = () => {
      const app: any = {
        appPATH: root + "/",
        loaded: [],
        apiTree: {},
        db: fakeDb(),
        settings: { [$item]: { setSchema() {}, addEventListener() {} } },
      };
      app.modules = new ModuleManager(app);
      app.stores = new StoreManager(app);
      return app;
    };

    const selected = createApp();
    selected.stores.add("./store.json").add("hello.world");
    await selected.stores.init();
    await selected.modules.init();
    assertEquals(selected.loaded, ["hello.world"]);
    assertEquals(Object.keys(selected.modules.all()), ["hello.world"]);

    const all = createApp();
    await all.stores.add(toFileUrl(root + "/store.json").href).addAll();
    await all.modules.init();
    assertEquals(all.loaded, ["hello.analytics", "hello.world"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ModuleManager init reports missing and circular dependencies", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(root + "/missing/", { recursive: true });
    await Deno.mkdir(root + "/not.imported/", { recursive: true });
    await Deno.mkdir(root + "/a/", { recursive: true });
    await Deno.mkdir(root + "/b/", { recursive: true });
    await Deno.writeTextFile(root + "/missing/plugin.ts", `
    `);
    await Deno.writeTextFile(root + "/missing/manifest.json", `{ "name": "missing.dep", "dependencies": ["not.imported"] }`);
    await Deno.writeTextFile(root + "/not.imported/plugin.ts", "");
    await Deno.writeTextFile(root + "/a/plugin.ts", `
    `);
    await Deno.writeTextFile(root + "/a/manifest.json", `{ "name": "cycle.a", "dependencies": ["cycle.b"] }`);
    await Deno.writeTextFile(root + "/b/plugin.ts", `
    `);
    await Deno.writeTextFile(root + "/b/manifest.json", `{ "name": "cycle.b", "dependencies": ["cycle.a"] }`);

    const app = {
      settings: { [$item]: { setSchema() {}, addEventListener() {} } },
      fire() {},
      db: fakeDb(),
    };

    const missing = new ModuleManager(app as any);
    await missing.import(toFileUrl(root + "/missing/plugin.ts").href);
    await assertRejects(
      () => missing.init(),
      Error,
      'Module "missing.dep" needs "not.imported"',
    );

    const installed = new ModuleManager({
      ...app,
      db: {
        ...fakeDb(),
        query: () => Promise.resolve([{
          name: "missing.dep",
          url: toFileUrl(root + "/missing/plugin.ts").href,
          installed: 1,
        }]),
      },
    } as any);
    await installed.init();
    assert(!installed.linked("missing.dep"));
    assert(installed.failures()["missing.dep"]);
    await installed.install(toFileUrl(root + "/not.imported/plugin.ts").href);
    assert(installed.linked("missing.dep"));
    assertEquals(installed.failures(), {});

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
