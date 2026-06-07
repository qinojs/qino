import { assertEquals } from "../../core/tests/deps.ts";
import { cms, name, needs } from "../plugin.ts";

Deno.test("cms.cont.text: metadata is wired", () => {
  assertEquals(name, "cms.cont.text");
  assertEquals(needs, ["cms"]);
});

Deno.test("cms.cont.text: render outputs main text", async () => {
  const node = {
    edit: false,
    showText: () => ({ id: 12, toString: () => "Hello" }),
  };
  assertEquals(await cms.node.render(node as never), "<div>Hello</div>");
});

Deno.test("cms.cont.text: render marks editable text", async () => {
  const node = {
    edit: true,
    showText: () => ({ id: 12, toString: () => "Hello" }),
  };
  assertEquals(await cms.node.render(node as never), "<div contenteditable cmstxt=12>Hello</div>");
});
