// deno-lint-ignore-file no-explicit-any
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fs } from "@qino/qino";
import { assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";
import { moduleTemplate } from "@qino/qino/cms.templateParser";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

function fakeNode(dir: string, app: any, edit = false) {
  const node: any = {
    id: 3,
    edit: () => edit,
    app,
    module: { name, source: new URL("../plugin.ts", import.meta.url).href, data: `${dir}data/${name}/` },
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

test("cms.layout.deck.1: header floats above the cards, main holds the deck", async () => {
  const dir = await fs.tempDir() + "/";
  const { out, ctx } = await render(dir);
  assertStringIncludes(out, `<main id="content"><div>main</div></main>`);
  assertStringIncludes(out, "<div>nav</div>"); // from the layout page
  assertStringIncludes(out, `<a href="/" class="cmsLink3"></a>`); // logo link remains while the image is empty
  assertEquals([...ctx.res.html.styles].some((s) => s.endsWith("css/norm/norm.css")), true);
  await fs.remove(dir, { recursive: true });
});

test("cms.layout.deck.1: the site starts from the shipped template", async () => {
  const dir = await fs.tempDir() + "/";
  const template = moduleTemplate(fakeNode(dir, {}).module);
  await render(dir, true);
  assertEquals(await fs.text(template.file), await fs.text(fileURLToPath(template.shipped)));
  assertStringIncludes(await fs.text(template.css), "--color");
  await fs.remove(dir, { recursive: true });
});
