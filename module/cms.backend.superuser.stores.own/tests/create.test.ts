import { assert, assertEquals } from "../../core/tests/deps.ts";
import { toFileUrl } from "@std/path";
import { App } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";
import { cms } from "../plugin.ts";

/** An app with one local module to copy from, outside the app's own module folder. */
async function fixture() {
  const dir = await Deno.makeTempDir() + "/";
  const tpl = dir + "tpl/cms.cont.demo/";
  await Deno.mkdir(tpl + "pub/", { recursive: true });
  await Deno.mkdir(tpl + "tests/", { recursive: true });
  await Deno.writeTextFile(`${tpl}plugin.ts`, ``);
    await Deno.writeTextFile(`${tpl}manifest.json`, `{ "name": "cms.cont.demo" }`);
  await Deno.writeTextFile(`${tpl}pub/main.css`, `[qcms-mod="cont.demo"] {\n}\n`);
  await Deno.writeTextFile(`${tpl}tests/demo.test.ts`, `// belongs to the template alone\n`);

  const app = new App({ appPATH: dir, db: `sqlite:${dir}test.sqlite` });
  app.modules.add(new URL("../../core/plugin.ts", import.meta.url));
  app.modules.add(toFileUrl(`${tpl}plugin.ts`).href);
  await app.init();
  return { dir, app, node: { app } as unknown as Node };
}

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
    assertEquals(JSON.parse(await Deno.readTextFile(dir + "module/t.blank/manifest.json")), { name: "t.blank" });

    const taken = await cms.node.api(node, { name: "cms.cont.cd.demo", template: "" });
    assertEquals(taken.ok, false, "the name is taken");
    const invalid = await cms.node.api(node, { name: "../escape", template: "" });
    assertEquals(invalid.ok, false, "no path may be smuggled in as a name");
    assertEquals(await cms.node.api(node, { name: "t.x", template: "t.unknown" }), {
      ok: false,
      message: `Template "t.unknown" is not a local module`,
    });
    assertEquals(await Deno.stat(dir + "module/t.x").then(() => true, () => false), false, "a failed create leaves nothing");

    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  },
});
