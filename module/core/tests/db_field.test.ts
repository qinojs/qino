// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { DbField } from "../lib/DbField.ts";

function field(type: string, extra: Record<string, any> = {}) {
  const table = { db: {}, toString: () => "tbl" };
  return new DbField(table as any, "value", {
    Type: type,
    Null: "NO",
    Key: "",
    Extra: "",
    Default: null,
    ...extra,
  });
}

Deno.test("DbField: parses type metadata", () => {
  const f = field("int(10) unsigned", { Key: "PRI", Extra: "auto_increment" });
  assertEquals(f.type, "int");
  assertEquals(f.length, "10");
  assertEquals(f.special, "unsigned");
  assertEquals(f.isPrimary(), true);
  assertEquals(f.isAutoIncrement(), true);
});

Deno.test("DbField: parses compound and fallback type metadata", () => {
  const decimal = field("decimal(10,2)");
  assertEquals(decimal.type, "decimal");
  assertEquals(decimal.length, "10,2");
  assertEquals(decimal.special, "");

  const varchar = field("varchar(191) CHARACTER SET utf8mb4");
  assertEquals(varchar.type, "varchar");
  assertEquals(varchar.length, "191");
  assertEquals(varchar.special, "character set utf8mb4");

  const fallback = field(undefined as any);
  assertEquals(fallback.type, "varchar");
  assertEquals(fallback.length, "");
  assertEquals(fallback.special, "");
});

Deno.test("DbField: valueTransform normalizes numeric, date and null values", () => {
  assertEquals(field("int(11)").valueTransform("12.5"), "12.5");
  assertEquals(field("int(11)").valueTransform("bad"), "0");
  assertEquals(field("decimal(10,2)").valueTransform("7.25"), "7.25");
  assertEquals(field("float").valueTransform("nope"), "0");
  assertEquals(field("date").valueTransform(1700000000), "2023-11-14 22:13:20");
  assertEquals(field("datetime").valueTransform(1700000000), "2023-11-14 22:13:20");
  assertEquals(field("int(11)", { Null: "YES" }).valueTransform(""), null);
  assertEquals(field("varchar(191)", { Null: "YES" }).valueTransform(""), "");
  assertEquals(field("text", { Null: "YES" }).valueTransform(""), "");
});

Deno.test("DbField: valueToSql quotes transformed values", () => {
  assertEquals(field("varchar(191)").valueToSql("a'b"), "'a\\'b'");
  assertEquals(field("int(11)").valueToSql("7"), "'7'");
  assertEquals(field("int(11)", { Null: "YES" }).valueToSql(null), "NULL");
});
