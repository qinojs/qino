// deno-lint-ignore-file no-explicit-any
import { test } from "node:test";
import { fs } from "../lib/fs.ts";
import { pathToFileURL } from "node:url";

import { assert, assertEquals, assertRejects } from "./deps.ts";
import { $item } from "../deps.ts";
import { Module, ModuleManager } from "../lib/ModuleManager.ts";
import { StoreManager } from "../lib/StoreManager.ts";
import { Emitter } from "../lib/Emitter.ts";
import { moduleIcon } from "../lib/util.ts";
import { requestStorage } from "../lib/ctx/Ctx.ts";

// The managers read their `module` and `store` rows on init; these tests have no database.
const fakeDb = () => ({
  listTables: () => Promise.resolve(["module", "store"]),
  query: () => Promise.resolve([]),
  table: () => ({ ensure: () => Promise.resolve(), delete: () => Promise.resolve() }),
});

test("moduleIcon trusts the manifest, and a remote module serves from the app's own url", () => {
  const source = "https://cdn.example/modules/remote.icon/plugin.ts";
  const remote = new Module({} as any, "remote.icon", {}, { files: ["pub/module.svg"] }, source);
  const plain = new Module({} as any, "plain", {}, {}, source);
  const ctx = { req: { moduleUrl: "https://site.test/m/" } } as any;

  requestStorage.run(ctx, () => {
    // the file was mirrored on import, so `<use>` reaches it — across origins it never would
    assertEquals(String(moduleIcon(remote)), `<use href="https://site.test/m/remote.icon/pub/module.svg#main" />`);
    assertEquals(moduleIcon(plain), undefined);
    assertEquals(String(moduleIcon(plain, "/fallback.svg")), `<use href="/fallback.svg#main" />`);
  });
});

test("ModuleManager imports modules and initializes by dependencies", async () => {
  const root = await fs.tempDir();
  const dir = root + "/";
  const localModDir = dir + "m/";
  await fs.mkdir(localModDir + "local.foo/");
  await fs.mkdir(dir + "private/private.foo/");
  await fs.mkdir(dir + "private/private.js/");
  await fs.mkdir(dir + "remote-ish/");

  await fs.write(localModDir + "local.foo/plugin.ts", `
  export const value = "local";
`);
  await fs.write(dir + "private/private.foo/plugin.ts", `
  export const value = "private";
  export async function install({ app }) {
    app.installed.push("private.foo");
  }
`);
  await fs.write(dir + "private/private.foo/manifest.json", `{ "name": "private.foo", "dependencies": ["local.foo"] }`);
  await fs.write(dir + "remote-ish/plugin.ts", `
  export const value = "file-url";
`);
  await fs.write(dir + "remote-ish/manifest.json", `{ "name": "remote-ish" }`);
  await fs.write(dir + "private/private.js/plugin.js", `
  export const value = "js";
`);
  await fs.write(dir + "private/private.js/manifest.json", `{ "name": "private.js" }`);

  const app = {
    dir,
    db: fakeDb(),
    installed: [],
    settings: { [$item]: { setSchema() {}, addEventListener() {} } },
  };
  const modules = new ModuleManager(app as any);
  const local = await modules.import(pathToFileURL(localModDir + "local.foo/plugin.ts").href);
  assertEquals(local.name, "local.foo");
  assertEquals(local.plugin.value, "local");
  assert(local.source.endsWith("/local.foo/plugin.ts"));

  await assertRejects(
    () => modules.import("./private/private.foo/"),
    Error,
    "Use app.modules.add",
  );

  assertEquals(local.data,  dir + "data/local.foo/");
  assertEquals(local.cache, dir + "cache/local.foo/");
  assertEquals(local.tmp,   dir + "tmp/local.foo/");

  const privateModule = await modules.import(pathToFileURL(dir + "private/private.foo/plugin.ts").href);
  assertEquals(privateModule.name, "private.foo");
  assertEquals(privateModule.plugin.value, "private");
  assert(modules.get("local.foo"));

  const jsModule = await modules.import(pathToFileURL(dir + "private/private.js/plugin.js").href);
  assertEquals(jsModule.name, "private.js");
  assertEquals(jsModule.plugin.value, "js");

  const fileUrlModule = await modules.import(pathToFileURL(dir + "remote-ish/plugin.ts").href);
  assertEquals(fileUrlModule.name, "remote-ish");
  assertEquals(fileUrlModule.plugin.value, "file-url");

  assertEquals(modules.get("private.foo")?.plugin.value, "private");
  assert(modules.get("private.foo")?.source.endsWith("/private.foo/plugin.ts"));
  await modules.init();
  assertEquals(app.installed, ["private.foo"]);

  await fs.remove(root, { recursive: true });
});

test("ModuleManager unlink tears down signal-bound listeners; re-link rebinds", async () => {
  const root = await fs.tempDir();
  const modDir = root + "/m/";
  await fs.mkdir(modDir + "sig.foo/");
  // init() registers a listener bound to the per-module signal
  await fs.write(modDir + "sig.foo/plugin.ts", `
    export function init(app, { signal }) {
      app.on("ping", (e) => { e.count++; }, { signal });
    }
  `);

  const bus = new Emitter<{ ping: { count: number } }>();
  const app = {
    dir: root + "/",
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

  await fs.remove(root, { recursive: true });
});

test("ModuleManager rejects invalid plugins", async () => {
  const root = await fs.tempDir();
  try {
    await fs.mkdir(root + "/bad/");
    await fs.write(root + "/plugin.ts", `export function init() {}`);
    await fs.write(root + "/manifest.json", `{ "name": 1 }`);
    await fs.write(root + "/bad/plugin.ts", `export function init() {}`);
    await fs.write(root + "/bad/manifest.json", `{ "name": "bad.dependencies", "dependencies": "core" }`);

    const modules = new ModuleManager({} as any);
    await assertRejects(
      () => modules.import(pathToFileURL(root + "/plugin.ts").href),
      Error,
      "has an invalid name",
    );
    await assertRejects(
      () => modules.import(pathToFileURL(root + "/bad/plugin.ts").href),
      Error,
      "dependencies must be an array",
    );
    await assertRejects(
      () => modules.import(pathToFileURL(root + "/").href),
      Error,
      "Plugin import needs a file",
    );
  } finally {
    await fs.remove(root, { recursive: true });
  }
});

test("Store selects modules by directory name", async () => {
  const root = await fs.tempDir();
  try {
    await fs.mkdir(root + "/hello.world/");
    await fs.mkdir(root + "/hello.analytics/");
    await fs.write(root + "/store.json", JSON.stringify({
      modules: {
        "hello.world": {},
        "hello.analytics": {},
      },
    }));
    await fs.write(root + "/hello.world/plugin.ts", `
      export function init(app) { app.loaded.push("hello.world"); }
    `);
    await fs.write(root + "/hello.analytics/plugin.ts", `
      export function init(app) { app.loaded.push("hello.analytics"); }
    `);

    const createApp = () => {
      const app: any = {
        dir: root + "/",
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
    assertEquals([...selected.modules.all().keys()], ["hello.world"]);

    const all = createApp();
    await all.stores.add(pathToFileURL(root + "/store.json").href).addAll();
    await all.modules.init();
    assertEquals(all.loaded, ["hello.analytics", "hello.world"]);
  } finally {
    await fs.remove(root, { recursive: true });
  }
});

test("ModuleManager init reports missing and circular dependencies", async () => {
  const root = await fs.tempDir();
  try {
    await fs.mkdir(root + "/missing/");
    await fs.mkdir(root + "/not.imported/");
    await fs.mkdir(root + "/a/");
    await fs.mkdir(root + "/b/");
    await fs.write(root + "/missing/plugin.ts", `
    `);
    await fs.write(root + "/missing/manifest.json", `{ "name": "missing.dep", "dependencies": ["not.imported"] }`);
    await fs.write(root + "/not.imported/plugin.ts", "");
    await fs.write(root + "/a/plugin.ts", `
    `);
    await fs.write(root + "/a/manifest.json", `{ "name": "cycle.a", "dependencies": ["cycle.b"] }`);
    await fs.write(root + "/b/plugin.ts", `
    `);
    await fs.write(root + "/b/manifest.json", `{ "name": "cycle.b", "dependencies": ["cycle.a"] }`);

    // Nothing locates the missing dependency, so init() has to report it.
    const app = {
      settings: { [$item]: { setSchema() {}, addEventListener() {} } },
      fire() {},
      db: fakeDb(),
    };

    const missing = new ModuleManager(app as any);
    await missing.import(pathToFileURL(root + "/missing/plugin.ts").href);
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
          url: pathToFileURL(root + "/missing/plugin.ts").href,
          installed: 1,
        }]),
      },
    } as any);
    await installed.init();
    assert(!installed.linked("missing.dep"));
    assert(installed.failures().has("missing.dep"));
    await installed.install(pathToFileURL(root + "/not.imported/plugin.ts").href);
    assert(installed.linked("missing.dep"));
    assertEquals(installed.failures().size, 0);

    const cyclic = new ModuleManager(app as any);
    await cyclic.import(pathToFileURL(root + "/a/plugin.ts").href);
    await cyclic.import(pathToFileURL(root + "/b/plugin.ts").href);
    await assertRejects(
      () => cyclic.init(),
      Error,
      "Circular module dependency",
    );
  } finally {
    await fs.remove(root, { recursive: true });
  }
});
