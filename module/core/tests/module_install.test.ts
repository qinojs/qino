import { assert, assertEquals, assertRejects, assertThrows } from "./deps.ts";
import { toFileUrl } from "../deps.ts";
import { App } from "../lib/App.ts";

const corePlugin = new URL("../plugin.ts", import.meta.url).href;

// Two throwaway modules: one the app declares, one installed at runtime. install() appends a line
// to a file, so "ran once" survives the second boot.
async function fixture(): Promise<string> {
  const dir = await Deno.makeTempDir() + "/";
  for (const name of ["t.one", "t.two"]) {
    await Deno.mkdir(dir + name, { recursive: true });
    await Deno.writeTextFile(`${dir + name}/plugin.ts`, `
      export async function install({ app }) {
        await Deno.writeTextFile(app.appPATH + "installs.log", "${name}\\n", { append: true });
      }
      export async function uninstall({ app }) {
        await Deno.writeTextFile(app.appPATH + "uninstalls.log", "${name}\\n", { append: true });
      }
    `);
    await Deno.writeTextFile(`${dir + name}/manifest.json`, `{ "dependencies": ["core"] }`);
  }
  // A bundle: brings the other two along, the way cms.installation.default does — from init(),
  // guarded by its own list, so an uninstalled one stays gone and a later addition still arrives.
  await Deno.mkdir(dir + "t.bundle", { recursive: true });
  await Deno.writeTextFile(`${dir}t.bundle/plugin.ts`, `
    export const settingsSchema = { properties: { seeded: { type: "string" } } };
    export async function init(app) {
      const setting = app.settings["t.bundle"].seeded;
      const seeded = String(await setting ?? "").split(",").filter(Boolean);
      const store = await app.stores.install(new URL("../store.json", import.meta.url));
      for (const mod of ["t.one", "t.two"]) {
        if (seeded.includes(mod)) continue;
        await app.modules.install(store.moduleUrl(mod), mod);
        seeded.push(mod);
      }
      await setting(seeded.join(","));
    }
    export async function install({ app }) {
      await Deno.writeTextFile(app.appPATH + "installs.log", "t.bundle\\n", { append: true });
    }
  `);
    await Deno.writeTextFile(`${dir}t.bundle/manifest.json`, `{ "name": "t.bundle", "dependencies": ["core"] }`);
  await Deno.writeTextFile(dir + "store.json", JSON.stringify({ modules: { "t.one": {}, "t.two": {}, "t.bundle": {} } }));
  return dir;
}

const lines = async (path: string) => (await Deno.readTextFile(path).catch(() => "")).split("\n").filter(Boolean);

Deno.test({
  name: "modules install once, come back after a restart and can be uninstalled",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await fixture();
    const boot = async () => {
      const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
      app.modules.add(corePlugin);
      app.modules.add(toFileUrl(`${dir}t.one/plugin.ts`).href);
      await app.init();
      return app;
    };

    const app1 = await boot();
    assert(app1.modules.declared("t.one"));
    assertEquals(await lines(dir + "installs.log"), ["t.one"]);

    await app1.modules.install(toFileUrl(`${dir}t.two/plugin.ts`).href, "t.two");
    assert(app1.modules.linked("t.two"));
    assert(!app1.modules.declared("t.two"), "a module installed at runtime is not declared");
    assertEquals(await lines(dir + "installs.log"), ["t.one", "t.two"]);
    await app1.db.close();

    // Second boot: only t.one is declared, t.two comes from its `module` row — and no install() re-runs.
    const app2 = await boot();
    assert(app2.modules.linked("t.two"), "installed module returns after a restart");
    assert(!app2.modules.declared("t.two"));
    assertEquals(await lines(dir + "installs.log"), ["t.one", "t.two"]);

    await assertRejects(() => app2.modules.uninstall("t.one"), Error, "the application declares it");
    await app2.modules.uninstall("t.two");
    assertEquals(await lines(dir + "uninstalls.log"), ["t.two"]);
    assertEquals(app2.modules.get("t.two"), undefined);
    assertEquals(await app2.db.query`SELECT name FROM module WHERE name = 't.two'`, []);
    await app2.db.close();

    const app3 = await boot();
    assertEquals(app3.modules.get("t.two"), undefined, "uninstalled stays uninstalled");
    await app3.db.close();

    await Deno.remove(dir, { recursive: true });
  },
});

/** Two modules of one store, one needing the other. */
async function chain(): Promise<string> {
  const dir = await Deno.makeTempDir() + "/";
  for (const [name, deps] of [["d.leaf", []], ["d.top", ["d.leaf"]]] as [string, string[]][]) {
    await Deno.mkdir(dir + name, { recursive: true });
    await Deno.writeTextFile(`${dir + name}/plugin.ts`, "export function init() {}\n");
    await Deno.writeTextFile(`${dir + name}/manifest.json`, JSON.stringify({ name, dependencies: ["core", ...deps] }));
  }
  await Deno.writeTextFile(dir + "store.json", JSON.stringify({ modules: { "d.leaf": {}, "d.top": {} } }));
  return dir;
}

// An application says what it wants, not the closure of what that needs: the manifest names the
// dependencies and the store knows where they live, so writing them out by hand is busywork.
Deno.test({
  name: "a store fills in the dependencies of what was asked for",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await chain();

    const declaring = new App({ appPATH: dir, db: `sqlite:${dir}a.sqlite` });
    declaring.modules.add(corePlugin);
    declaring.stores.add(new URL(toFileUrl(dir + "store.json").href)).add("d.top");
    await declaring.init();
    assert(declaring.modules.linked("d.leaf"), "declared d.top, got d.leaf along");
    await declaring.db.close();

    // The same at runtime, where it also has to be remembered — both are installed, both removable.
    const installing = new App({ appPATH: dir, db: `sqlite:${dir}b.sqlite` });
    installing.modules.add(corePlugin);
    const store = installing.stores.add(new URL(toFileUrl(dir + "store.json").href));
    await installing.init();
    await store.install("d.top");
    assert(installing.modules.linked("d.leaf"));
    assertEquals(
      (await installing.db.query`SELECT name FROM module WHERE url > '' ORDER BY name`).map((r) => r.name),
      ["d.leaf", "d.top"],
    );
    await installing.db.close();

    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "a bundle installs its own set; repair and reset re-run the seed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await fixture();
    const boot = async () => {
      const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
      app.modules.add(toFileUrl(`${dir}t.bundle/plugin.ts`).href);
      await app.init();
      return app;
    };

    const app1 = await boot();
    assert(app1.modules.linked("t.one") && app1.modules.linked("t.two"), "the bundle brought its set");
    assert(!app1.modules.declared("t.one"), "a recommended module stays uninstallable-able");
    assertEquals((await lines(dir + "installs.log")).sort(), ["t.bundle", "t.one", "t.two"]);
    await app1.db.close();

    const app2 = await boot(); // the set comes back from its rows, and no install() re-runs
    assert(app2.modules.linked("t.one"));
    assertEquals((await lines(dir + "installs.log")).length, 3);

    await app2.modules.repair("t.one"); // seeds again, keeps what is there
    assertEquals((await lines(dir + "installs.log")).length, 4);
    assertEquals(await lines(dir + "uninstalls.log"), []);

    await app2.modules.reset("t.one"); // removes first, then seeds
    assertEquals(await lines(dir + "uninstalls.log"), ["t.one"]);
    assertEquals((await lines(dir + "installs.log")).length, 5);

    await assertRejects(() => app2.modules.reset("t.bundle"), Error, "no uninstall()");

    await app2.modules.uninstall("t.two");
    await app2.db.close();

    const app3 = await boot();
    assertEquals(app3.modules.get("t.two"), undefined, "what the user removed is not brought back");
    assert(app3.modules.linked("t.one"));
    await app3.db.close();

    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "an installed module that cannot be imported is shouted about, not fatal",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await fixture();
    const boot = async () => {
      const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
      app.modules.add(corePlugin);
      await app.init();
      return app;
    };

    const app1 = await boot();
    // A row pointing nowhere — same situation as a deleted folder or an unreachable host.
    await app1.db.table("module").ensure({ name: "t.gone", url: toFileUrl(`${dir}t.gone/plugin.ts`).href });
    await app1.db.close();

    const app2 = await boot(); // boots at all: that is the assertion
    assert(app2.modules.failures()["t.gone"], "the failed import is reported");
    assertEquals(app2.modules.get("t.gone"), undefined);

    await app2.modules.uninstall("t.gone"); // the way out, without a plugin to ask
    assertEquals(app2.modules.failures(), {});
    assertEquals(await app2.db.query`SELECT name FROM module WHERE name = 't.gone'`, []);
    await app2.db.close();

    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "a row without a url is no failure, but uninstall still reaches it",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await fixture();
    const boot = async () => {
      const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
      app.modules.add(corePlugin);
      await app.init();
      return app;
    };

    const app1 = await boot();
    // What an installation older than the url column leaves behind: a name, and nothing saying where
    // it came from. Boot cannot judge it — a store may well still offer that name.
    await app1.db.table("module").ensure({ name: "t.leftover", installed: 1 });
    await app1.db.close();

    const app2 = await boot();
    assertEquals(app2.modules.failures(), {}, "not broken: the name may still be on offer somewhere");
    assertEquals(app2.modules.get("t.leftover"), undefined);

    await assertRejects(() => app2.modules.uninstall("t.never"), Error, "unknown");
    await app2.modules.uninstall("t.leftover"); // the row is reason enough, no plugin needed
    assertEquals(await app2.db.query`SELECT name FROM module WHERE name = 't.leftover'`, []);
    await app2.db.close();

    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "stores are removable exactly when the application does not declare them",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await fixture();
    const catalog = toFileUrl(dir + "store.json").href;
    const boot = async () => {
      const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
      app.modules.add(corePlugin);
      await app.init();
      return app;
    };

    const app1 = await boot();
    assertEquals(app1.stores.all().length, 0);
    await app1.stores.install(catalog);
    assertEquals(app1.stores.all().map((s) => s.declared), [false]);
    await app1.db.close();

    const app2 = await boot();
    assertEquals(app2.stores.all().map((s) => s.url), [catalog], "store survives the restart");
    await app2.stores.uninstall(catalog);
    assertEquals(app2.stores.all().length, 0);
    await app2.db.close();

    const app3 = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
    app3.modules.add(corePlugin);
    app3.stores.add(catalog); // declared in the application now
    await app3.init();
    assertEquals(app3.stores.all().map((s) => s.declared), [true]);
    await assertRejects(() => app3.stores.uninstall(catalog), Error, "the application declares it");
    await app3.db.close();

    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "a folder store lists its module folders and resolves them like a catalog does",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await fixture();
    const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
    const folder = app.stores.add(toFileUrl(dir).href);
    const catalog = app.stores.add(toFileUrl(dir + "store.json").href);

    assertEquals(await folder.names(), await catalog.names(), "same modules, other discovery");
    assertEquals(folder.moduleUrl("t.one"), catalog.moduleUrl("t.one"), "the module URL is convention, not catalog");
    assertEquals(folder.base, catalog.base);

    // A store takes a name, never a URL — that is what a caller holding request input can be given.
    app.modules.add(corePlugin);
    await app.init();
    assertEquals((await folder.install("t.one")).source, folder.moduleUrl("t.one"));
    assertThrows(() => folder.install("../elsewhere"), Error, "Invalid module name");

    await Deno.writeTextFile(dir + "not-a-module.txt", ""); // a file is no module
    await Deno.mkdir(dir + "t.empty"); // …and neither is a folder without a plugin
    assertEquals(await folder.names(), ["t.bundle", "t.one", "t.two"]);

    await assertRejects(
      () => app.stores.add("https://mods.example.com/store/").names(),
      Error,
      "a remote store needs a store.json",
    );

    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  },
});

// Two stores offering the same name: the module can be moved from one to the other without
// reinstalling it — the row and everything it owns stay, only the code comes from elsewhere.
Deno.test({
  name: "a module can be relocated to another store",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    for (const store of ["a", "b"]) {
      await Deno.mkdir(`${dir + store}/r.mod`, { recursive: true });
      await Deno.writeTextFile(`${dir + store}/r.mod/plugin.ts`, `
        export const from = "${store}";
        export async function install({ app }) {
          await Deno.writeTextFile(app.appPATH + "installs.log", "${store}\\n", { append: true });
        }
      `);
      await Deno.writeTextFile(`${dir + store}/r.mod/manifest.json`, `{ "dependencies": ["core"] }`);
    }
    const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
    app.modules.add(corePlugin);
    const [a, b] = [app.stores.add(toFileUrl(dir + "a/").href), app.stores.add(toFileUrl(dir + "b/").href)];
    await app.init();

    await a.install("r.mod");
    assertEquals(app.modules.get("r.mod")?.plugin.from, "a");

    await app.modules.relocate("r.mod", b.moduleUrl("r.mod"));
    assertEquals(app.modules.get("r.mod")?.plugin.from, "b", "the code now comes from the other store");
    assert(app.modules.linked("r.mod"), "and it is linked again");
    assertEquals((await app.db.query`SELECT url FROM module WHERE name = 'r.mod'`)[0].url, b.moduleUrl("r.mod"));
    assertEquals(await lines(dir + "installs.log"), ["a"], "install() belongs to the row, not to the source");

    await assertRejects(() => app.modules.relocate("core", corePlugin), Error, "the application declares it");
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  },
});
