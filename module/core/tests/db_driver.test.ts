import { assertEquals } from "./deps.ts";
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
  const driver = makeDriver("postgres:host=localhost;dbname=qino", "qino", "secret");
  assertEquals(driver.dialect, "postgres");
  assertEquals(driver.emptyInsert, "DEFAULT VALUES");
  assertEquals(driver.escapeId('a"b'), '"a""b"');
  await driver.close();
});
