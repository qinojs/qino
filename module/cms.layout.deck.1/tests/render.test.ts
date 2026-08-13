// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertStringIncludes, testContext } from "../../core/tests/deps.ts";
import { fromFileUrl } from "@std/path";
import { moduleTemplate } from "../../cms.templateParser/mod.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name } = manifest;

const moduleDir = fromFileUrl(new URL("../", import.meta.url));

function fakeNode(dir: string, app: any, edit = false) {
  const node: any = {
    id: 3,
    edit,
    app,
    module: { name, dir: moduleDir, source: "", data: `${dir}data/${name}/` },
    page: () => node,
    parent: () => node,
    file: () => undefined, // no logo yet
    cont: (part: string) => ({ html: () => `<div>${part}</div>` }),
  };
  node.cms = { layoutPage: () => node, linkAttributes: () => ({ href: "/", class: "cmsLink3" }) };
  return node;
}

const render = async (dir: string, edit = false) => {
  const ctx = await testContext();
  const out = await cms.node.render(fakeNode(dir, ctx.app, edit), { ctx } as any);
  return { out, ctx };
};

Deno.test("cms.layout.deck.1: header floats above the cards, main holds the deck", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const { out, ctx } = await render(dir);
  assertStringIncludes(out, `<main id="content"><div>main</div></main>`);
  assertStringIncludes(out, "<div>nav</div>"); // from the layout page
  assertStringIncludes(out, `<a href="/" class="cmsLink3"></a>`); // logo link remains while the image is empty
  assertEquals([...ctx.res.html.styles].some((s) => s.endsWith("css/norm/norm.css")), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.layout.deck.1: the site starts from the shipped template", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const template = moduleTemplate(fakeNode(dir, {}).module);
  await render(dir, true);
  assertEquals(await Deno.readTextFile(template.file), await Deno.readTextFile(template.shipped));
  assertStringIncludes(await Deno.readTextFile(template.css), "--color");
  await Deno.remove(dir, { recursive: true });
});
