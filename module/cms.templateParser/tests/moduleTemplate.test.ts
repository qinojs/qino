// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertStringIncludes, fakeT, testContext } from "../../core/tests/deps.ts";
import { requestStorage } from "../../core/mod.ts";
import { layoutOptions, moduleTemplate } from "../mod.ts";

const name = "cms.layout.test";

const fakeNode = (access: number) => ({
  app: { t: fakeT },
  module: { name, source: `file:///app/module/${name}/plugin.ts`, data: `/app/data/${name}/` },
  cms: { layoutPage: () => ({ access: () => Promise.resolve(access) }) },
});

const panel = async (access: number) => {
  const ctx = await testContext({
    app: { modules: { linked: () => true }, assertAllowedPath: () => {} },
    sess: { data: { fileEditor: { key: () => "test-key" } } },
  });
  return await requestStorage.run(ctx as any, () => layoutOptions(fakeNode(access) as any));
};

Deno.test("moduleTemplate: the site's copy lies in the app dir, the shipped one next to the plugin", () => {
  const template = moduleTemplate(fakeNode(2).module as any);
  assertEquals(template.file, `/app/data/${name}/template.html`);
  assertEquals(template.css, `/app/data/${name}/pub/main.css`);
  assertEquals(template.shipped.href, `file:///app/module/${name}/template.html`);
});

Deno.test("layoutOptions: the layout page decides, editing is enough", async () => {
  assertEquals(await panel(1), false); // read access on the layout page
  const out = String(await panel(2));
  assertStringIncludes(out, "fileEditor?file=");
  assertStringIncludes(out, ">template.html</a>");
  assertStringIncludes(out, ">main.css</a>");
});
