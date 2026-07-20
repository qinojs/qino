// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { DbTable } from "../lib/db/DbTable.ts";
import { Db } from "../lib/db/Db.ts";
import { fakeRender } from "./sqlFake.ts";
import { sql } from "../../../deps.ts";

function db() {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const returns: Array<string | undefined> = [];
  const events: Array<[string, Record<string, unknown>]> = [];
  const rows = [{ id: 1, name: "One", parent: null }];
  const fake = {
    calls,
    returns,
    events,
    tables: {},
    emptyInsert: "() VALUES ()",
    escapeId: (id: string) => `\`${id}\``,
    table: () => undefined,
    syncAutoIncrement() {},
    columns(table: string) {
      return this.query(`SHOW FULL COLUMNS FROM \`${table}\``);
    },
    query(...a: any[]) {
      const [sql, params] = fakeRender(a[0], a.slice(1));
      calls.push([sql, params]);
      if (sql.startsWith("SHOW FULL COLUMNS")) return [
        { Field: "id", Type: "int(11)", Null: "NO", Key: "PRI", Extra: "auto_increment", Default: null },
        { Field: "name", Type: "varchar(191)", Null: "NO", Key: "", Extra: "", Default: null },
        { Field: "parent", Type: "int(11)", Null: "YES", Key: "", Extra: "", Default: null },
      ];
      if (sql.startsWith("SELECT")) return rows;
      return [];
    },
    all(...a: any[]) {
      const [sql, params] = fakeRender(a[0], a.slice(1));
      calls.push([sql, params]);
      return rows;
    },
    row(...a: any[]) {
      const [sql, params] = fakeRender(a[0], a.slice(1));
      calls.push([sql, params]);
      return;
    },
    // exec is called either as a tag (UPDATE/DELETE) or with a fragment + returning (INSERT)
    exec(...a: any[]) {
      const isTag = Array.isArray(a[0]?.raw);
      const [sql, params] = fakeRender(a[0], isTag ? a.slice(1) : []);
      calls.push([sql, params]);
      returns.push(isTag ? undefined : a[1]);
      return { affectedRows: 1, insertId: 10 };
    },
    transaction(fn: () => Promise<unknown>) {
      return fn();
    },
    fire(name: string, data: Record<string, unknown>) {
      events.push([name, data]);
    },
  };
  return fake;
}

Deno.test("DbTable: init discovers fields, primary and auto increment", async () => {
  const fake = db();
  const table = new DbTable(fake as any, "thing");
  await table.init();

  assertEquals(Object.keys(table.fields ?? {}), ["id", "name", "parent"]);
  assertEquals(String(table.primary), "id");
  assertEquals(String(table.autoIncrement), "id");
});

Deno.test("DbTable: entry id and where fragments use field transforms", async () => {
  const table = new DbTable(db() as any, "thing");
  await table.init();

  assertEquals(table.entryId({ id: "7.9" }), "7.9");
  assertEquals(table.entryIdValues("7"), { id: "7" });
  assertEquals(fakeRender(table.entryIdToFragment("7"), []), ["`id` = ?", ["7"]]);
  assertEquals(
    fakeRender(table.valuesToFragment({ id: "7", name: "A", parent: null }, "t"), []),
    ["`t`.`id` = ? AND `t`.`name` = ? AND `t`.`parent` IS NULL", ["7", "A"]],
  );
  assertEquals(
    fakeRender(table.valuesToFragment({ name: "A" }, undefined, true), []),
    ["`name` = ?", ["A"]],
  );
});

Deno.test("DbTable: schema fields and children come from db schema", async () => {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const fake: any = {
    tables: {},
    emptyInsert: "() VALUES ()",
    escapeId: (id: string) => `\`${id}\``,
    schema: {
      properties: {
        child: {
          additionalProperties: {
            properties: {
              parent_id: { "x-qg-parent": "parent", "x-qg-on-parent-delete": "cascade" },
            },
          },
        },
      },
    },
    columns(table: string) {
      return this.query(`SHOW FULL COLUMNS FROM \`${table}\``);
    },
    query(sql: string, params?: unknown[]) {
      calls.push([sql, params]);
      if (sql.includes("`parent`")) return [
        { Field: "id", Type: "int(11)", Null: "NO", Key: "PRI", Extra: "auto_increment", Default: null },
      ];
      return [
        { Field: "parent_id", Type: "int(11)", Null: "NO", Key: "", Extra: "", Default: null },
      ];
    },
  };
  const parent = fake.tables.parent = new DbTable(fake, "parent");
  const child = fake.tables.child = new DbTable(fake, "child");
  await parent.init();
  await child.init();

  const field = child.field("parent_id");
  assertEquals(child.schema.additionalProperties.properties.parent_id["x-qg-parent"], "parent");
  assertEquals(parent.children.map(String), ["parent_id"]);
  assertEquals(field && field.onParentDelete, "cascade");
});

Deno.test("DbTable: select, insert, update and delete build parameterized SQL", async () => {
  const fake = db();
  const table = new DbTable(fake as any, "thing");
  await table.init();

  assertEquals(await table.select(sql`id = ${1}`), { "1": { id: 1, name: "One", parent: null } });
  assertEquals(fake.calls.some(([sql, p]) => sql === "SELECT * FROM `thing` WHERE id = ?" && Array.isArray(p) && p[0] === 1), true);
  await table.select();
  assertEquals(await table.insert({ name: "Two" }), "10");
  assertEquals(await table.update("10", { name: "Ten" }), "10");
  assertEquals(await table.delete("10"), true);

  assertEquals(fake.calls.some(([sql]) => sql === "INSERT INTO `thing` (`name`) VALUES (?)"), true);
  assertEquals(fake.calls.some(([sql]) => sql === "SELECT * FROM `thing` WHERE TRUE"), true);
  assertEquals(fake.returns[0], "id");
  assertEquals(fake.calls.some(([sql]) => sql === "UPDATE `thing` SET `name` = ? WHERE `id` = ?"), true);
  assertEquals(fake.calls.some(([sql]) => sql === "DELETE FROM `thing` WHERE `id` = ?"), true);
  assertEquals(fake.events.map(([name]) => name), [
    "table:insert-before",
    "table:insert-after",
    "table:update-before",
    "table:update-after",
    "table:delete-before",
    "table:delete-after",
  ]);
});

Deno.test("DbTable: copy and delete cascade via x-qg-parent-field on real sqlite", async () => {
  const real = new Db("sqlite:");
  await real.exec`CREATE TABLE parent (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL)`;
  await real.exec`CREATE TABLE child (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_code TEXT, val TEXT)`;
  await real.exec`CREATE TABLE child2 (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, val TEXT)`;
  real.schema = { properties: {
    child: { additionalProperties: { properties: {
      parent_code: { "x-qg-parent": "parent", "x-qg-parent-field": "code", "x-qg-on-parent-copy": "cascade", "x-qg-on-parent-delete": "cascade" },
    } } },
    child2: { additionalProperties: { properties: {
      parent_id: { "x-qg-parent": "parent", "x-qg-on-parent-copy": "cascade", "x-qg-on-parent-delete": "cascade" },
    } } },
  } };
  await real.loadTables();
  const parent = real.table("parent");

  const pid = await parent.insert({ code: "A" });
  await real.table("child").insert({ parent_code: "A", val: "c1" });
  await real.table("child").insert({ parent_code: "A", val: "c2" });
  await real.table("child").insert({ parent_code: "X", val: "cx" });
  await real.table("child2").insert({ parent_id: pid, val: "k1" });

  // copy: children follow the non-primary parent field resp. the new primary id
  const newId = await parent.copy(pid, { code: "B" });
  assertEquals((await real.query`SELECT val FROM child WHERE parent_code = ${"B"} ORDER BY id`).map((r) => r.val), ["c1", "c2"]);
  assertEquals((await real.query`SELECT val FROM child2 WHERE parent_id = ${newId} ORDER BY id`).map((r) => r.val), ["k1"]);

  // delete: only children of the deleted row's parent-field value go away
  await parent.delete(pid);
  assertEquals((await real.query`SELECT parent_code FROM child ORDER BY id`).map((r) => r.parent_code), ["X", "B", "B"]);
  assertEquals((await real.query`SELECT parent_id FROM child2`).map((r) => String(r.parent_id)), [newId]);
  await real.close();
});
