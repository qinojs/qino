import { assert, assertEquals, assertRejects } from "./deps.ts";
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
      export const needs = ["core"];
      export async function install({ app }) {
        await Deno.writeTextFile(app.appPATH + "installs.log", "${name}\\n", { append: true });
      }
      export async function uninstall({ app }) {
        await Deno.writeTextFile(app.appPATH + "uninstalls.log", "${name}\\n", { append: true });
      }
    `);
  }
  await Deno.writeTextFile(dir + "store.json", JSON.stringify({ modules: { "t.one": {}, "t.two": {} } }));
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
