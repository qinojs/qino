import { assertEquals, assertThrows } from "./deps.ts";
import { makeDriver } from "../lib/dbDriver.ts";

Deno.test("PostgreSQL driver exposes its dialect and renders $n placeholders", async () => {
  const driver = makeDriver("postgresql://qino:secret@localhost/qino");
  assertEquals(driver.dialect, "postgres");
  assertEquals(driver.emptyInsert, "DEFAULT VALUES");
  assertEquals(driver.escapeId('a"b'), '"a""b"');
  assertEquals([driver.placeholder(1), driver.placeholder(2)], ["$1", "$2"]);
  await driver.close();
});

Deno.test("MySQL driver exposes its dialect and renders ? placeholders", async () => {
  const driver = makeDriver("mysql://qino:secret@localhost/qino");
  assertEquals(driver.dialect, "mysql");
  assertEquals(driver.emptyInsert, "() VALUES ()");
  assertEquals(driver.escapeId("a`b"), "`a``b`");
  assertEquals(driver.placeholder(1), "?");
  await driver.close();
});

Deno.test("DB driver rejects unsupported connection strings", () => {
  assertThrows(() => makeDriver("mysql:host=localhost;dbname=qino"));
});
