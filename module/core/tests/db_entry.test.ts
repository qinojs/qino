// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { DbEntry, getEntryClass, registerEntryClass } from "../lib/db/DbEntry.ts";

class CustomEntry extends DbEntry {}

Deno.test("DbEntry: registerEntryClass overrides lookup by table name", () => {
  assertEquals(getEntryClass("missing"), DbEntry);
  registerEntryClass("custom_table", CustomEntry);
  assertEquals(getEntryClass("custom_table"), CustomEntry);
});

Deno.test("DbEntry: constructor derives id from object values", async () => {
  const table = {
    fields: null,
    entryId: (vs: any) => String(vs.id),
    selectByID: () => ({ id: 5, name: "Five" }),
  };
  const entry = new DbEntry(table as any, { id: 5 });
  assertEquals(String(entry), "5");
  assertEquals(await entry.exists(), entry);
  assertEquals(await entry.get("name"), "Five");
});

Deno.test("DbEntry: set and save update changed values through table", async () => {
  const updates: unknown[] = [];
  const field = {
    isPrimary: () => false,
    valueTransform: (v: unknown) => String(v).trim(),
  };
  const table = {
    fields: { id: { isPrimary: () => true }, name: field },
    field: (name: string) => name === "name" ? field : undefined,
    entryId: (vs: any) => String(vs.id),
    selectByID: () => ({ id: 7, name: "Old" }),
    update: (id: string, vs: Record<string, unknown>) => updates.push([id, vs]),
  };
  const entry = new DbEntry(table as any, { id: 7 });
  await entry.set("name", " New ");
  await entry.save();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assertEquals(updates, [["7", { id: 7, name: "New" }]]);
});
