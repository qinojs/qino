import { assertEquals, assertThrows } from "./deps.ts";
import { makeDriver } from "../lib/dbDriver.ts";

Deno.test("PostgreSQL driver exposes its dialect and escapes identifiers", async () => {
  const driver = makeDriver("postgresql://qino:secret@localhost/qino");
  assertEquals(driver.dialect, "postgres");
  assertEquals(driver.escapeId('a"b'), '"a""b"');
  await driver.close();
});

Deno.test("MySQL driver exposes its dialect and escapes identifiers", async () => {
  const driver = makeDriver("mysql://qino:secret@localhost/qino");
  assertEquals(driver.dialect, "mysql");
  assertEquals(driver.escapeId("a`b"), "`a``b`");
  await driver.close();
});

Deno.test("DB driver rejects unsupported connection strings", () => {
  assertThrows(() => makeDriver("mysql:host=localhost;dbname=qino"));
});
