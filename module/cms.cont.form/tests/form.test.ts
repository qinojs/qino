import { requestStorage } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { fields, Form, formOf, openForm } from "../mod.ts";

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

Deno.test("Form.value reflects the submitted body only once sent", () => {
  const form = new Form();
  assertEquals(form.sent, false);
  assertEquals(form.value("name"), undefined);

  form.posted = { name: "hand" };
  assertEquals(form.sent, true);
  assertEquals(form.value("name"), "hand");
  assertEquals(form.value("missing"), "", "a sent form reports untouched fields as empty");
});

/** A node of `module` with `conts`; a field block's fields map name → label. */
function tree(module: string, conts: unknown[] = [], fields?: Record<string, string>, sort = "") {
  return {
    vs: { module },
    conts: () => Promise.resolve(conts),
    settings: { fields: fields ?? {}, sort: () => sort },
    showText: (name: string) => Promise.resolve({ plain: () => fields?.[name.replace(/_title$/, "")] ?? "" }),
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("fields: every field block in the form, nested ones too, in render order", async () => {
  const form = tree("cms.cont.form", [
    tree("cms.cont.flexible", [
      tree("cms.cont.form.fields", [], { name: "Name", email: "E-Mail" }, "email,name"),
      tree("cms.cont.text"),
      tree("cms.cont.form.fields", [], { street: "Street", name: "Name again" }),
      tree("cms.cont.form", [tree("cms.cont.form.fields", [], { other: "Other form" })]),
    ]),
  ]);
  assertEquals([...await fields(form)], [["email", "E-Mail"], ["name", "Name"], ["street", "Street"]]);
});
