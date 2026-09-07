// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";

import { moduleTemplate } from "../mod.ts";

const name = "cms.layout.test";

const fakeModule = { name, source: `file:///app/module/${name}/plugin.ts`, data: `/app/data/${name}/` };

Deno.test("moduleTemplate: the site's copy lies in the app dir, the shipped one next to the plugin", () => {
  const template = moduleTemplate(fakeModule as any);
  assertEquals(template.file, `/app/data/${name}/template.html`);
  assertEquals(template.css, `/app/data/${name}/pub/main.css`);
  assertEquals(template.shipped.href, `file:///app/module/${name}/template.html`);
});
