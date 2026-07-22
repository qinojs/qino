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

Deno.test("SQLite keeps concurrent access out of an open transaction", async () => {
  const driver = DbDriver.from("sqlite:");
  await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");

  // Transaction inserts then rolls back; it awaits inside, so an outside write
  // running meanwhile must NOT join it (the reported isolation bug).
  const rolledBack = driver.transaction(async () => {
    await driver.exec("INSERT INTO t (v) VALUES ('tx')");
    await Promise.resolve();
    throw new Error("boom");
  }).catch((e) => (e as Error).message);

  // Fired while the transaction is in-flight: serialized after it, must survive the rollback.
  const outside = driver.exec("INSERT INTO t (v) VALUES ('outside')");

  assertEquals(await rolledBack, "boom");
  await outside;

  const rows = await driver.query("SELECT v FROM t ORDER BY v");
  assertEquals(rows.map((r) => r.v), ["outside"]);
  await driver.close();
});
