import { assertEquals, assertThrows } from "./deps.ts";
import { DbDriver } from "../lib/db/DbDriver.ts";
import { Db } from "../lib/db/Db.ts";

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

Deno.test("a schema boolean survives a dialect without a boolean type", async () => {
  const schema = {
    properties: {
      t: {
        additionalProperties: {
          properties: {
            id: { type: "integer", "x-index": "primary", "x-autoincrement": true },
            flag: { type: "boolean" },
            count: { type: "integer" },
          },
          required: ["id"],
        },
      },
    },
  };
  const db = new Db("sqlite::memory:");
  await db.migrate(schema, { patch: true });
  db.schema = schema;
  await db.loadTables();
  try {
    await db.table("t").insert({ id: 1, flag: true, count: 7 });
    await db.table("t").insert({ id: 2, flag: false, count: 0 });
    // SQLite writes a boolean into an INTEGER column, so the wrong path here stores the text
    // "false" — which is truthy, turning every later check of the value into a silent yes.
    const rows = await db.query`SELECT id, flag, typeof(flag) AS kind, count FROM t ORDER BY id`;
    assertEquals(rows.map((r) => r.kind), ["integer", "integer"]);
    assertEquals(rows.map((r) => !!r.flag), [true, false]);
    assertEquals(rows.map((r) => r.count), [7, 0]);
  } finally {
    await db.close();
  }
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

Deno.test("afterCommit defers side effects to the outermost commit", async () => {
  const db = new Db("sqlite:");
  const done: string[] = [];

  // No transaction → runs straight away.
  await db.afterCommit(() => void done.push("bare"));
  assertEquals(done, ["bare"]);

  // Nested transaction: the hook must wait for the OUTER commit, not the inner one.
  await db.transaction(async () => {
    await db.transaction(() => db.afterCommit(() => void done.push("committed")));
    assertEquals(done, ["bare"]);
  });
  assertEquals(done, ["bare", "committed"]);

  // Rollback → the hook never runs.
  await db.transaction(async () => {
    await db.afterCommit(() => void done.push("rolled back"));
    throw new Error("boom");
  }).catch(() => {});
  assertEquals(done, ["bare", "committed"]);

  await db.close();
});

Deno.test("a write escaping its transaction does not run on the finished one", async () => {
  const driver = DbDriver.from("sqlite:");
  await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");

  // Node settings save via a debounced setTimeout: the ALS context of the transaction is
  // still active when it fires, but the transaction is long over.
  let late!: Promise<unknown>;
  await driver.transaction(async () => {
    await driver.exec("INSERT INTO t (v) VALUES ('inside')");
    late = new Promise((ok) => setTimeout(() => ok(driver.exec("INSERT INTO t (v) VALUES ('late')")), 5));
  });
  await late;

  // Both rows are there and the late one committed on its own — not swallowed by a closed tx.
  const rows = await driver.query("SELECT v FROM t ORDER BY v");
  assertEquals(rows.map((r) => r.v), ["inside", "late"]);
  await driver.close();
});
