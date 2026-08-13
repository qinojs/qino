// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

// App settings stub: app.settings["cms.cont.flexible"]["init-child-module"]
const appWith = (initModule: string) => ({ settings: { [name]: { "init-child-module": initModule } } });

// node.settings is an item.js proxy: a leaf reads when called bare and writes when given a value.
const nodeSettings = (inited?: boolean) => ({
  __inited: (value?: boolean) => value === undefined ? inited : (inited = value),
});

Deno.test("cms.cont.flexible: metadata is wired", () => {
  assertEquals(name, "cms.cont.flexible");
});

Deno.test("cms.cont.flexible: render concatenates child html", async () => {
  const node = {
    app: appWith(""),
    conts: () => [
      { html: () => "<p>A</p>" },
      { html: () => "<p>B</p>" },
    ],
  };
  assertEquals(await cms.node.render(node as any, { vars: {} }), "<div><p>A</p><p>B</p></div>");
});

Deno.test("cms.cont.flexible: render initializes default child when empty", async () => {
  const calls: string[] = [];
  let initialized = false;
  const settings = nodeSettings();
  const node = {
    app: appWith("cms.cont.text"),
    settings,
    conts: () => initialized ? [{ html: () => "<p>Init</p>" }] : [],
    cont: (_name: string, module: string) => {
      calls.push(module);
      initialized = true;
    },
  };
  assertEquals(await cms.node.render(node as any, { vars: {} }), "<div><p>Init</p></div>");
  assertEquals(calls, ["cms.cont.text"]);
  assertEquals(settings.__inited(), true); // remembered, so the next render does not start over
});

Deno.test("cms.cont.flexible: an emptied container stays empty", async () => {
  const calls: string[] = [];
  const node = {
    app: appWith("cms.cont.text"),
    settings: nodeSettings(true), // initialised once, then the user deleted every child
    conts: () => [],
    cont: (_name: string, module: string) => void calls.push(module),
  };
  assertEquals(await cms.node.render(node as any, { vars: {} }), "<div></div>");
  assertEquals(calls, []);
});
