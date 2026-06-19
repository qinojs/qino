import { assertEquals, assertThrows } from "./deps.ts";
import { makeDriver, toPostgresSql } from "../lib/dbDriver.ts";

Deno.test("PostgreSQL SQL adapter converts placeholders and identifiers", () => {
  assertEquals(
    toPostgresSql("SELECT `id`, '?' AS literal FROM `thing` WHERE `name` = ? AND `id` = ?"),
    "SELECT \"id\", '?' AS literal FROM \"thing\" WHERE \"name\" = $1 AND \"id\" = $2",
  );
});

Deno.test("PostgreSQL SQL adapter leaves comments and quoted question marks untouched", () => {
  assertEquals(
    toPostgresSql("SELECT ? -- ?\n/* ? */ WHERE value = 'it''s ?'"),
    "SELECT $1 -- ?\n/* ? */ WHERE value = 'it''s ?'",
  );
});

Deno.test("PostgreSQL SQL adapter converts MySQL escaped string literals", () => {
  assertEquals(toPostgresSql("SELECT 'a\\'b\\\\c\\n'"), "SELECT 'a''b\\c\n'");
});

Deno.test("PostgreSQL SQL adapter converts simple MySQL DDL types", () => {
  assertEquals(toPostgresSql("CREATE TABLE t (id INT(11), changed DATETIME)"), "CREATE TABLE t (id BIGINT, changed TIMESTAMP)");
});

Deno.test("PostgreSQL driver exposes its dialect", async () => {
  const driver = makeDriver("postgresql://qino:secret@localhost/qino");
  assertEquals(driver.dialect, "postgres");
  assertEquals(driver.emptyInsert, "DEFAULT VALUES");
  assertEquals(driver.escapeId('a"b'), '"a""b"');
  await driver.close();
});

Deno.test("MySQL driver exposes its dialect from URL", async () => {
  const driver = makeDriver("mysql://qino:secret@localhost/qino");
  assertEquals(driver.dialect, "mysql");
  assertEquals(driver.emptyInsert, "() VALUES ()");
  assertEquals(driver.escapeId("a`b"), "`a``b`");
  await driver.close();
});

Deno.test("DB driver rejects unsupported connection strings", () => {
  assertThrows(() => makeDriver("mysql:host=localhost;dbname=qino"));
});
