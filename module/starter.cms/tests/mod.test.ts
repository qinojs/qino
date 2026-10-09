import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };

const store = import.meta.resolve("../../store.json");

const boot = async (dir: string, starter = true) => {
  const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
  const added = app.stores.add(store).add("cms");
  if (starter) added.add("starter.cms");
  await app.init();
  return app;
};

/** Every page with its name and parent — the shape of the site in one value. */
const tree = async (app: App) =>
  (await app.db.query`SELECT id, basis, name, module FROM page ORDER BY id`).map((r) => `${r.id}<${r.basis} ${r.name ?? ""} ${r.module}`);

const html = async (app: App, path: string) => {
  const res = await app.fetch(new Request("http://localhost" + path));
  return { status: res.status, body: await res.text() };
};

const quiet = { sanitizeOps: false, sanitizeResources: false };

/** A directory for one test, removed even when the test fails. */
const inTempDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = await Deno.makeTempDir() + "/";
  try { await fn(dir); } finally { await Deno.remove(dir, { recursive: true }); }
};

Deno.test("starter.cms: every module it brings is in the store", async () => {
  const catalog = JSON.parse(await Deno.readTextFile(new URL("../../store.json", import.meta.url)));
  assertEquals(manifest.dependencies.filter((mod) => !catalog.modules[mod]), []);
  assertEquals(new Set(manifest.dependencies).size, manifest.dependencies.length);
});

Deno.test({
  name: "starter.cms: builds a site once, fills gaps on repair, and leaves it to the site",
  ...quiet,
  fn: () => inTempDir(async (dir) => {
    const app = await boot(dir);

    const home = await html(app, "/en/home");
    assertEquals(home.status, 200);
    assert(home.body.includes("<h1>Welcome</h1>"));
    assert(home.body.includes('href="/en/imprint"'), "footer links resolve");
    assert(home.body.includes('href="/en/system/login"'), "the welcome text leads to the login");
    assert(!home.body.includes('href="/en/first-steps"'), "guests don't see the checklist in the menu");
    for (const item of ["todo-account", "todo-identity", "todo-mail", "todo-legal", "todo-languages"]) {
      const [section, ...more] = (await cms(app).nodesByName(item)).values();
      assertEquals(more, [], item);
      assertEquals((await section.conts()).map((c) => `${c.vs.name} ${c.vs.module}`), ["main cms.cont.text"], item);
    }
    // the menu first, then the checklist, the pages only linked to, and what runs the site
    const order = (await (await cms(app).node(1)).children({ type: "p" })).values().map((p) => p.vs.name ?? p.vs.module);
    assertEquals([...order], [
      "home", "contact", "first-steps", "search", "imprint", "privacy", "system", "cms.layout.backend",
    ]);
    const login = (await cms(app).nodesByName("login")).values().next().value!;
    const form = (await (await login.cont("main")).conts()).find((c) => c.vs.module === "cms.cont.login4")!;
    const homeId = Number(await app.db.one`SELECT redirect FROM page_redirect WHERE request = ''`);
    assertEquals(Number(await form.settings.redirect()), homeId, "signed in, the login page leads home");
    const contact = await html(app, "/en/contact");
    assert(contact.body.includes('name="email"') && contact.body.includes("<textarea"), "contact form has its fields");
    assertEquals((await html(app, "/en/no-such-page")).status, 404);
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM usr WHERE superuser = ${true}`), 1);
    const file = `${dir}data/starter.cms/superuser.txt`;
    assert((await Deno.readTextFile(file)).startsWith("email: su\npassword: "), "the password is kept for who missed the log");
    assertEquals((await Deno.stat(file)).mode! & 0o777, 0o600);

    const built = await tree(app); // after rendering: the layout adds its nav on first use
    // repair runs install() again: nothing doubles, a deleted page comes back
    await app.modules.repair("starter.cms");
    assertEquals(await tree(app), built);
    const imprint = (await cms(app).nodesByName("imprint")).values().next().value!;
    await (await imprint.parent())!.removeChild(imprint);
    await app.modules.repair("starter.cms");
    assert((await cms(app).nodesByName("imprint")).size === 1, "a deleted page is restored");
    await app.db.close();

    // its modules were handed over: without the starter the site keeps them
    const after = await boot(dir, false);
    assert(after.modules.linked("cms.cont.form4") && !after.modules.get("starter.cms"));
    assertEquals((await html(after, "/en/contact")).status, 200);
    await after.modules.uninstall("cms.cont.search1"); // and each can go on its own
    await after.db.close();
  }),
});

Deno.test({
  name: "starter.cms: installs into a running app",
  ...quiet,
  fn: () => inTempDir(async (dir) => {
    const app = await boot(dir, false);
    const own = await (await cms(app).node(1)).createChild({ name: "home", access: 1 }); // the site's own home
    await app.stores.add(store).install("starter.cms");
    assertEquals([...(await cms(app).nodesByName("home")).keys()], [own.id], "an existing page is kept, not doubled");
    assertEquals((await html(app, "/en/contact")).status, 200);
    await app.db.close();
  }),
});
