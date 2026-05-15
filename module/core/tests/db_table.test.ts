// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../../deps.ts";
import { DbTable } from "../lib/DbTable.ts";

function db() {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const events: Array<[string, Record<string, unknown>]> = [];
  const rows = [{ id: 1, name: "One", parent: null }];
  const fake = {
    calls,
    events,
    tables: {},
    table: () => undefined,
    query(sql: string, params?: unknown[]) {
      calls.push([sql, params]);
      if (sql.startsWith("SHOW FULL COLUMNS")) return [
        { Field: "id", Type: "int(11)", Null: "NO", Key: "PRI", Extra: "auto_increment", Default: null },
        { Field: "name", Type: "varchar(191)", Null: "NO", Key: "", Extra: "", Default: null },
        { Field: "parent", Type: "int(11)", Null: "YES", Key: "", Extra: "", Default: null },
      ];
      return [];
    },
    all(sql: string, params?: unknown[]) {
      calls.push([sql, params]);
      return rows;
    },
    row(sql: string, params?: unknown[]) {
      calls.push([sql, params]);
      return undefined;
    },
    exec(sql: string, params?: unknown[]) {
      calls.push([sql, params]);
      return { affectedRows: 1, insertId: 10 };
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

Deno.test("DbTable: entry id and where/set helpers use field transforms", async () => {
  const table = new DbTable(db() as any, "thing");
  await table.init();

  assertEquals(table.entryId({ id: "7.9" }), "7.9");
  assertEquals(table.entryId2Array("7"), { id: "7" });
  assertEquals(table.entryId2where("7"), "`id` = '7'");
  assertEquals(table.valuesToWhere({ id: "7", name: "A", parent: null }, "t"), "`t`.`id` = '7' AND `t`.`name` = 'A' AND `t`.`parent` IS NULL");
  assertEquals(table.valuesToSet({ name: "A" }), "`name` = 'A'");
});

Deno.test("DbTable: schema fields and children come from db schema", async () => {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const fake: any = {
    tables: {},
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

  assertEquals(await table.select("`id` = ?", [1]), { "1": { id: 1, name: "One", parent: null } });
  assertEquals(await table.insert({ name: "Two" }), "10");
  assertEquals(await table.update("10", { name: "Ten" }), "10");
  assertEquals(await table.delete("10"), true);

  assertEquals(fake.calls.some(([sql]) => sql === "INSERT INTO `thing` SET `name` = ?"), true);
  assertEquals(fake.calls.some(([sql]) => sql === "UPDATE `thing` SET `name` = ? WHERE `id` = ?"), true);
  assertEquals(fake.calls.some(([sql]) => sql === "DELETE FROM `thing` WHERE `id` = ?"), true);
  assertEquals(fake.events.map(([name]) => name), [
    "table::insert-before",
    "table::insert-after",
    "table::update-before",
    "table::update-after",
    "table::delete-before",
    "table::delete-after",
  ]);
});
