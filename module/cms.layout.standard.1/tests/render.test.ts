// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";
import { cms } from "../plugin.ts";
import { moduleTemplate } from "@qino/qino/cms.templateParser";
import manifest from "../manifest.json" with { type: "json" };
const { name } = manifest;

function fakeNode(dir: string, app: any, edit = false) {
  const node: any = {
    id: 3,
    edit,
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
  const ctx = await testContext(); // no brand set anywhere
  const out = await cms.node.render(fakeNode(dir, ctx.app, edit), { ctx } as any);
  return { out, ctx };
};

Deno.test("cms.layout.standard.1: renders the shipped template and adds the u2 assets", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const { out, ctx } = await render(dir);
  assertStringIncludes(out, `<div id="container">`);
  assertStringIncludes(out, "<div>main</div>"); // the page content
  assertStringIncludes(out, "<div>nav</div>"); // from the layout page
  assertStringIncludes(out, `<a href="/" class="cmsLink3"></a>`); // logo link remains while the image is empty
  const u2 = [...ctx.res.html.styles].find((s) => s.endsWith("css/norm/norm.css"))!;
  assertStringIncludes(u2, "u2@"); // pinned in the layout, not taken from core
  assertEquals(ctx.res.csp["script-src"][u2.replace("css/norm/norm.css", "")], true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.layout.standard.1: the first render in edit mode gives the site its own copy", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const code = moduleTemplate(fakeNode(dir, {}).module);
  await render(dir, true);
  assertEquals(await Deno.readTextFile(code.file), await Deno.readTextFile(code.shipped));
  assertStringIncludes(await Deno.readTextFile(code.css), "#container");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("cms.layout.standard.1: the site's copy wins, and is kept as it is", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const code = moduleTemplate(fakeNode(dir, {}).module);
  await Deno.mkdir(`${dir}data/${name}/`, { recursive: true });
  await Deno.writeTextFile(code.file, "<div id=own><cms-cont name=main /></div>");

  const { out } = await render(dir, true);
  assertEquals(out, `<div id="own"><div>main</div></div>`);
  assertEquals(await Deno.stat(code.css).catch(() => null), null); // a file deleted here is not written again
  await Deno.remove(dir, { recursive: true });
});
