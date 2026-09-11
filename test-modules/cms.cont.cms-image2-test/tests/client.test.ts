// deno-lint-ignore-file no-explicit-any
import { runInNewContext } from "node:vm";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms-image2 test: lab reload updates the part without the edit-mode CMS global", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  const calls: unknown[] = [];
  const part = { innerHTML: "initial" };
  const button = { disabled: false };
  const root: any = {
    dataset: { delay: "0" },
    closest: () => ({ getAttribute: () => "42" }),
    querySelectorAll: () => [],
    querySelector: (selector: string) => selector === "[cms-part=lab]" ? part
      : selector === "[data-c2t-reload]" ? button : null,
  };
  const context: any = {
    document: { addEventListener() {}, querySelectorAll: () => [] },
    setTimeout: () => 0,
    api: { cms: { node: (id: string) => ({ html: { part: (name: string) => ({ post: async (body: any) => {
      calls.push([id, name, body]);
      return `<div style="--image-width:${body.vars.lab.width}px"></div>`;
    } }) } }) } },
  };
  runInNewContext(source.replace(/^import .*;\n/gm, ""), context);
  for (const width of [240, 480]) {
    await context.reloadLab(root, { width }, button);
    assertEquals(part.innerHTML, `<div style="--image-width:${width}px"></div>`);
    assertEquals(button.disabled, false);
    assertEquals(root.__c2tReloading, false);
  }
  assertEquals(JSON.parse(JSON.stringify(calls)), [
    ["42", "lab", { vars: { lab: { width: 240 } } }],
    ["42", "lab", { vars: { lab: { width: 480 } } }],
  ]);
});
