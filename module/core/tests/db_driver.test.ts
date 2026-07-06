import { assertEquals, assertThrows } from "./deps.ts";
import { DbDriver } from "../lib/db/DbDriver.ts";

Deno.test("PostgreSQL driver exposes its dialect and escapes identifiers", async () => {
  const driver = DbDriver.from("postgresql://qino:secret@localhost/qino");
  assertEquals(driver.dialect, "postgres");
  assertEquals(driver.quoteId('a"b'), '"a""b"');
  await driver.close();
});

Deno.test("MySQL driver exposes its dialect and escapes identifiers", async () => {
  const driver = DbDriver.from("mysql://qino:secret@localhost/qino");
  assertEquals(driver.dialect, "mysql");
  assertEquals(driver.quoteId("a`b"), "`a``b`");
  await driver.close();
});

Deno.test("DB driver rejects unsupported connection strings", () => {
  assertThrows(() => DbDriver.from("mysql:host=localhost;dbname=qino"));
});
