import { assertEquals } from "@qino/qino/tests";

import { fieldName, RESERVED } from "../mod.ts";

Deno.test("fieldName turns a label into a name", () => {
  assertEquals(fieldName("Ihre Bemerkung"), "ihre_bemerkung");
  assertEquals(fieldName("E-Mail"), "e_mail");
  assertEquals(fieldName("Grösse in m²"), "groesse_in_m");
  assertEquals(fieldName("Prénom"), "prenom");
  assertEquals(fieldName("  ***  "), "feld", "a label without letters still needs a name");
});

Deno.test("fieldName defuses names that mean something on an object", () => {
  for (const name of RESERVED) assertEquals(fieldName(name), name + "_", `"${name}" has to give way`);

  // the two that would not merely shadow: a prototype write and an accidental thenable
  const values: Record<string, unknown> = {};
  values[fieldName("__proto__")] = { polluted: true };
  values[fieldName("Then")] = "resolve me";
  assertEquals(({} as Record<string, unknown>).polluted, undefined, "Object.prototype stays untouched");
  assertEquals(typeof (values as { then?: unknown }).then, "undefined", "the bag is not a thenable");
});
