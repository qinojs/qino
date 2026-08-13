import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";
import { toFileUrl } from "@std/path";
import { App, Module } from "@qino/qino";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

/** An app with one local module to copy from, outside the app's own module folder. */
async function fixture() {
  const dir = await Deno.makeTempDir() + "/";
  const tpl = dir + "tpl/cms.cont.demo/";
  await Deno.mkdir(tpl + "pub/", { recursive: true });
  await Deno.mkdir(tpl + "tests/", { recursive: true });
  await Deno.writeTextFile(`${tpl}plugin.ts`, ``);
  await Deno.writeTextFile(`${tpl}manifest.json`, `{ "name": "cms.cont.demo", "files": ["manifest.json", "plugin.ts", "pub/main.css"] }`);
  await Deno.writeTextFile(`${tpl}pub/main.css`, `[qcms-mod="cont.demo"] {\n}\n`);
  await Deno.writeTextFile(`${tpl}tests/demo.test.ts`, `// belongs to the template alone\n`);

  const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
  app.modules.add(new URL("../../core/plugin.ts", import.meta.url));
  app.modules.add(toFileUrl(`${tpl}plugin.ts`).href);
  app.stores.add(new URL(toFileUrl(dir + "module/").href)); // what the module's install() hook does
  await app.init();
  return { dir, app, node: { app } as unknown as Node };
}

Deno.test("own modules link to module administration details", async () => {
  const app = {
    appPATH: "/app/",
    t: (strings: TemplateStringsArray) => strings.join(""),
    stores: { get: () => ({ names: () => Promise.resolve(["cms.cont.own"]) }) },
    modules: { all: () => ({}), linked: () => true },
  };
  const node = {
    app,
    cms: { nodeByModule: () => ({ page: () => ({ access: () => 1, url: () => "/backend/superuser/module" }) }) },
  };
  const out = String(await cms.node.render(node as unknown as Node));
  assertStringIncludes(out, `href="/backend/superuser/module?mod=cms.cont.own"`);
});

Deno.test({
  name: "a module is copied from a template, renamed in both forms and installed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { dir, app, node } = await fixture();

    assertEquals(await cms.node.api(node, { name: "cms.cont.cd.demo", template: "cms.cont.demo" }), { ok: true });
    assert(app.modules.linked("cms.cont.cd.demo"), "installed and linked right away");

    const made = dir + "module/cms.cont.cd.demo/";
    assert((await Deno.readTextFile(made + "manifest.json")).includes(`"name": "cms.cont.cd.demo"`), "the manifest is renamed with the rest");
    assertEquals(await Deno.readTextFile(made + "pub/main.css"), `[qcms-mod="cont.cd.demo"] {\n}\n`, "qcms-mod form replaced");
    assertEquals(await Deno.stat(made + "tests").then(() => true, () => false), false, "the template's tests stay behind");

    // Blank knows no module shape: what a module must have, and nothing a CMS would expect.
    assertEquals(await cms.node.api(node, { name: "t.blank", template: "" }), { ok: true });
    assertEquals(await Deno.readTextFile(dir + "module/t.blank/plugin.ts"), "export function init() {}\n");
    assertEquals(JSON.parse(await Deno.readTextFile(dir + "module/t.blank/manifest.json")), {
      name: "t.blank",
      files: ["manifest.json", "plugin.ts"],
    });

    const taken = await cms.node.api(node, { name: "cms.cont.cd.demo", template: "" });
    assertEquals(taken.ok, false, "the name is taken");
    const invalid = await cms.node.api(node, { name: "../escape", template: "" });
    assertEquals(invalid.ok, false, "no path may be smuggled in as a name");
    assertEquals(await cms.node.api(node, { name: "t.x", template: "t.unknown" }), {
      ok: false,
      message: `Template "t.unknown" is not available`,
    });
    assertEquals(await Deno.stat(dir + "module/t.x").then(() => true, () => false), false, "a failed create leaves nothing");

    const remote = new Module(
      app,
      "cms.cont.remote",
      {},
      { files: ["manifest.json", "plugin.ts", "pub/main.css", "pub/pixel.bin", "pub/name#part.txt"] },
      "https://modules.example/cms.cont.remote/plugin.ts",
    );
    app.modules.all()[remote.name] = remote;
    const assets = new Map<string, BodyInit>([
      ["manifest.json", JSON.stringify({ name: remote.name, files: remote.manifest.files })],
      ["plugin.ts", "export function init() {}\n"],
      ["pub/main.css", `[qcms-mod="cont.remote"] {\n}\n`],
      ["pub/pixel.bin", new Uint8Array([0xff, 0x00, 0xfe])],
      ["pub/name#part.txt", remote.name],
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const source = new URL(url);
      if (source.hostname !== "modules.example") return originalFetch(input, init);
      const body = assets.get(decodeURIComponent(source.pathname).replace("/cms.cont.remote/", ""));
      return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(body));
    };
    try {
      assertEquals(await cms.node.api(node, { name: "cms.cont.remote.copy", template: remote.name }), { ok: true });
      assets.delete("plugin.ts");
      assertEquals((await cms.node.api(node, { name: "cms.cont.remote.failed", template: remote.name })).ok, false);
      assets.set("plugin.ts", `export function init() { throw new Error("broken template") }`);
      assertEquals((await cms.node.api(node, { name: "cms.cont.remote.broken", template: remote.name })).ok, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const copied = dir + "module/cms.cont.remote.copy/";
    assert((await Deno.readTextFile(copied + "manifest.json")).includes(`"name":"cms.cont.remote.copy"`), "remote manifest is renamed");
    assertEquals(await Deno.readTextFile(copied + "pub/main.css"), `[qcms-mod="cont.remote.copy"] {\n}\n`);
    assertEquals(await Deno.readFile(copied + "pub/pixel.bin"), new Uint8Array([0xff, 0x00, 0xfe]));
    assertEquals(await Deno.readTextFile(copied + "pub/name#part.txt"), "cms.cont.remote.copy");
    assertEquals(await Deno.stat(dir + "module/cms.cont.remote.failed").then(() => true, () => false), false, "a failed download leaves nothing");
    assertEquals(app.modules.get("cms.cont.remote.broken"), undefined, "a module that cannot link is forgotten");

    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  },
});
