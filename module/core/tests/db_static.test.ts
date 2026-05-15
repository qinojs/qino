import { assertEquals, assertThrows } from "../../../deps.ts";
import { Db } from "../lib/Db.ts";

Deno.test("Db.quote escapes SQL string literals", () => {
  assertEquals(Db.quote(null), "NULL");
  assertEquals(Db.quote("a'b\\c\n"), "'a\\'b\\\\c\\n'");
});

Deno.test("Db._array_to_column_definition builds compact MySQL column definitions", () => {
  assertEquals(
    Db._array_to_column_definition({ type: "varchar", null: true }),
    " VARCHAR(191)  NULL ",
  );
  assertEquals(
    Db._array_to_column_definition({ type: "int", special: "unsigned", default: 0 }),
    " INT UNSIGNED NOT NULL DEFAULT ?",
  );
  assertEquals(
    Db._array_to_column_definition({ type: "text", collate: "utf8mb4_unicode_520_ci" }),
    " TEXT  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci NOT NULL ",
  );
});

Deno.test("Db._array_to_column_definition rejects unknown type/special", () => {
  assertThrows(() => Db._array_to_column_definition({ type: "json" }), Error, 'field type "JSON" not allowed');
  assertThrows(() => Db._array_to_column_definition({ type: "int", special: "primary key" }), Error, 'field special "PRIMARY KEY" not allowed');
});
