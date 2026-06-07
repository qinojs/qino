// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { cms, name } from "../plugin.ts";

Deno.test("cms.cont.flexible: metadata is wired", () => {
  assertEquals(name, "cms.cont.flexible");
});

Deno.test("cms.cont.flexible: render concatenates child html", async () => {
  const node = {
    settings: { "init-child-module": () => "" },
    conts: () => ({
      a: { html: () => "<p>A</p>" },
      b: { html: () => "<p>B</p>" },
    }),
  };
  assertEquals(await cms.node.render(node as any, { vars: {} }), "<div><p>A</p><p>B</p></div>");
});

Deno.test("cms.cont.flexible: render initializes default child when empty", async () => {
  const calls: string[] = [];
  let initialized = false;
  const node = {
    settings: { "init-child-module": () => "cms.cont.text" },
    conts: () => initialized ? { init: { html: () => "<p>Init</p>" } } : {},
    cont: (_name: string, module: string) => {
      calls.push(module);
      initialized = true;
    },
  };
  assertEquals(await cms.node.render(node as any, { vars: {} }), "<div><p>Init</p></div>");
  assertEquals(calls, ["cms.cont.text"]);
});
