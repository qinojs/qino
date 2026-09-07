// deno-lint-ignore-file no-explicit-any
import { requestStorage } from "@qino/qino";
import { assertEquals, fakeT, testContext } from "@qino/qino/tests";

import { moduleTemplate } from "../mod.ts";
import { layoutEditorLinks, mayEditLayout } from "../moduleTemplate.ts";

const name = "cms.layout.test";

const fakeNode = (access: number) => ({
  app: { t: fakeT },
  module: { name, source: `file:///app/module/${name}/plugin.ts`, data: `/app/data/${name}/` },
  cms: { layoutPage: () => ({ access: () => Promise.resolve(access) }) },
});

const inRequest = async <T>(fn: () => T) => {
  const ctx = await testContext({
    app: { modules: { linked: () => true }, assertAllowedPath: () => {} },
    sess: { data: { core: { grantKey: () => "test-key" } } },
  });
  return await requestStorage.run(ctx as any, fn);
};

Deno.test("moduleTemplate: the site's copy lies in the app dir, the shipped one next to the plugin", () => {
  const template = moduleTemplate(fakeNode(2).module as any);
  assertEquals(template.file, `/app/data/${name}/template.html`);
  assertEquals(template.css, `/app/data/${name}/pub/main.css`);
  assertEquals(template.shipped.href, `file:///app/module/${name}/template.html`);
});

Deno.test("mayEditLayout: the layout page decides, editing is enough", async () => {
  assertEquals(await mayEditLayout(fakeNode(1) as any), false); // read access on the layout page
  assertEquals(await mayEditLayout(fakeNode(2) as any), true);
});

Deno.test("layoutEditorLinks: both template files, each url a capability", async () => {
  const links = await inRequest(() => layoutEditorLinks(fakeNode(2) as any));
  assertEquals(links.map((l) => l.name), ["template.html", "main.css"]);
  assertEquals(links.every((l) => l.url.includes("fileEditor?file=")), true);
});
