import { assertEquals, testContext } from "../../core/tests/deps.ts";
import { requestStorage } from "../../core/mod.ts";
import { Form, formOf, openForm } from "../mod.ts";

/** Minimal stand-in: only `id` and `path()` matter for the form lookup. */
function node(id: number, ancestors: number[] = []) {
  const path = new Map<number, unknown>();
  for (const a of ancestors) path.set(a, null);
  path.set(id, null);
  // deno-lint-ignore no-explicit-any
  return { id, path: () => Promise.resolve(path) } as any;
}

Deno.test("formOf finds the nearest open form up the tree", async () => {
  const ctx = await testContext();
  await requestStorage.run(ctx, async () => {
    const outer = openForm(node(10));
    const inner = openForm(node(20, [10]));

    assertEquals(await formOf(node(30, [10, 20])), inner, "innermost form wins");
    assertEquals(await formOf(node(31, [10])), outer);
    assertEquals(await formOf(node(32, [99])), undefined, "outside any form");
  });
});

Deno.test("formOf returns undefined while no form is open", async () => {
  const ctx = await testContext();
  await requestStorage.run(ctx, async () => {
    assertEquals(await formOf(node(5, [1])), undefined);
  });
});

Deno.test("Form.value reflects the submitted body only once sent", () => {
  const form = new Form();
  assertEquals(form.sent, false);
  assertEquals(form.value("name"), undefined);

  form.posted = { name: "hand" };
  assertEquals(form.sent, true);
  assertEquals(form.value("name"), "hand");
  assertEquals(form.value("missing"), "", "a sent form reports untouched fields as empty");
});

Deno.test("Form.value takes the last of a repeated field name", () => {
  const form = new Form();
  // a checked checkbox posts twice: its empty hidden twin first, then the box itself
  form.posted = { agree: ["", "1"], plain: [""] };
  assertEquals(form.value("agree"), "1");
  assertEquals(form.value("plain"), "", "an unchecked box stays empty");
});
