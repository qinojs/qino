import { assertEquals } from "../../core/tests/deps.ts";
import { Db } from "../../core/mod.ts";
import { tableStatus } from "../../cms.backend.superuser.db/mod.ts";
import { cleanOrphans, dropExtraField, dropExtraTable, findOrphans, maintain, maintenanceActions, schemaExtras } from "../lib/cleanup.ts";
import { createMissingIndex, dropRedundantIndex, indexIssues } from "../lib/indexes.ts";
import { sequenceIssue, syncSequence } from "../lib/sequences.ts";
import { isEmptyField, validateTable } from "../lib/validate.ts";
import { cms, name, needs } from "../plugin.ts";

async function testDb(): Promise<Db> {
  const db = new Db("sqlite:");
  await db.exec`CREATE TABLE parent (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await db.exec`CREATE TABLE child (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, stale TEXT)`;
  await db.exec`CREATE TABLE optional (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER)`;
  await db.exec`CREATE TABLE strict (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL)`;
  await db.exec`CREATE TABLE extra (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  db.schema = { properties: {
    parent: { additionalProperties: {
      properties: { id: { type: "integer", "x-index": "primary" }, name: { type: "string", enum: ["kept"], maxLength: 4 } },
      required: ["id", "name"],
    } },
    child: { additionalProperties: { properties: {
      id: { type: "integer" },
      parent_id: { type: "integer", "x-qg-parent": "parent", "x-qg-on-parent-delete": "cascade" },
    } } },
    optional: { additionalProperties: { properties: {
      id: { type: "integer" },
      parent_id: { type: "integer", "x-qg-parent": "parent", "x-qg-on-parent-delete": "setnull" },
    } } },
    strict: { additionalProperties: {
      properties: {
        id: { type: "integer" },
        parent_id: { type: "integer", "x-qg-parent": "parent", "x-qg-on-parent-delete": "setnull" },
      },
      required: ["id", "parent_id"],
    } },
  } };
  await db.loadTables();
  return db;
}

Deno.test("cms.backend.superuser.db.cleanup: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser.db.cleanup");
  assertEquals(needs, ["cms.backend.superuser.db"]);
  assertEquals(typeof cms.node.api, "function");
});

Deno.test("cms.backend.superuser.db.cleanup: finds and deletes orphan relations", async () => {
  const db = await testDb();
  const parent = await db.table("parent").insert({ name: "kept" });
  await db.table("child").insert({ parent_id: parent });
  await db.table("child").insert({ parent_id: 999 });
  await db.table("child").insert({ parent_id: null });
  const optional = await db.table("optional").insert({ parent_id: 999 });

  const issues = await findOrphans(db);
  assertEquals(issues.map(({ table, field, onDelete, count }) => ({ table, field, onDelete, count })), [
    { table: "child", field: "parent_id", onDelete: "cascade", count: 1 },
    { table: "optional", field: "parent_id", onDelete: "setnull", count: 1 },
  ]);
  assertEquals(await cleanOrphans(db, "child", "parent_id"), { cleaned: 1, remaining: 0, action: "cascade" });
  assertEquals(await cleanOrphans(db, "optional", "parent_id"), { cleaned: 1, remaining: 0, action: "setnull" });
  assertEquals(await db.one`SELECT COUNT(*) FROM child`, 2);
  assertEquals((await db.table("optional").selectByID(optional!))?.parent_id, null);
  await db.close();
});

Deno.test("cms.backend.superuser.db.cleanup: only removes structures outside the schema", async () => {
  const db = await testDb();
  assertEquals(schemaExtras(db).map(({ table, field }) => [table, field]), [["child", "stale"], ["extra", undefined]]);

  await dropExtraField(db, "child", "stale");
  await dropExtraTable(db, "extra");
  assertEquals(schemaExtras(db), []);
  await db.close();
});

Deno.test("cms.backend.superuser.db.cleanup: exposes supported SQLite maintenance", async () => {
  const db = await testDb();
  const status = await tableStatus(db, "child");
  assertEquals(maintenanceActions(db, status), ["check", "analyze", "reindex"]);
  assertEquals(await maintain(db, "check", "child", status), "ok");
  await db.close();
});

Deno.test("cms.backend.superuser.db.cleanup: renders one table-centric overview", async () => {
  const db = await testDb();
  await db.table("child").insert({ parent_id: 999 });
  await db.table("strict").insert({ parent_id: 999 });
  const out = String(await cms.node.render({ app: { db } } as never));
  assertEquals(out.match(/<table/g)?.length, out.match(/<\/table>/g)?.length);
  assertEquals((out.match(/<table/g)?.length ?? 0) > 1, true);
  assertEquals(out.includes("data-action=clean-orphans"), true);
  assertEquals(out.includes("Outside schema in extra"), true);
  assertEquals(out.includes("data-inspect=\"orphans\""), true);
  assertEquals(out.includes("Parent empty"), true);
  assertEquals(out.includes('disabled title="field is NOT NULL"'), true);
  assertEquals(out.includes("missing"), true);
  assertEquals(out.includes("parent_id"), true);
  assertEquals(out.includes("<u2-menubutton>"), true);
  assertEquals(out.includes("<details>"), false);
  assertEquals(out.includes("data-table-search"), true);
  assertEquals(out.includes("u2-table -Sticky"), true);
  assertEquals(out.includes("data-sort-handler"), true);
  assertEquals(out.includes(">Overhead"), true);
  await db.close();
});

Deno.test("cms.backend.superuser.db.cleanup: manages only verified index issues", async () => {
  const db = await testDb();
  assertEquals((await indexIssues(db, "child")).some((issue) => issue.kind === "missing" && issue.field === "parent_id"), true);
  await createMissingIndex(db, "child", "parent_id");
  assertEquals((await indexIssues(db, "child")).some((issue) => issue.kind === "missing" && issue.field === "parent_id"), false);

  await db.exec`CREATE INDEX duplicate_parent ON child(parent_id)`;
  const duplicate = (await indexIssues(db, "child")).find((issue) => issue.kind === "duplicate");
  assertEquals(duplicate?.actionable, true);
  await dropRedundantIndex(db, "child", duplicate!.index!);
  assertEquals((await indexIssues(db, "child")).some((issue) => issue.kind === "duplicate" || issue.kind === "redundant"), false);
  await db.close();
});

Deno.test("cms.backend.superuser.db.cleanup: validates portable schema rules and empty extra fields", async () => {
  const db = await testDb();
  assertEquals(await isEmptyField(db, "child", "stale"), true);
  await db.exec`INSERT INTO child (parent_id, stale) VALUES (${null}, ${"legacy"})`;
  await db.exec`INSERT INTO parent (name) VALUES (${"wrong-long"}), (${null})`;
  assertEquals(await isEmptyField(db, "child", "stale"), false);
  assertEquals(await validateTable(db, "parent"), [
    { field: "name", rule: "required", count: 1 },
    { field: "name", rule: "enum", count: 1 },
    { field: "name", rule: "maxLength 4", count: 1 },
  ]);
  await db.close();
});

Deno.test("cms.backend.superuser.db.cleanup: repairs a verified auto-id sequence", async () => {
  const db = await testDb();
  await db.table("parent").insert({ name: "kept" });
  await db.exec`UPDATE sqlite_sequence SET seq = ${0} WHERE name = ${"parent"}`;
  assertEquals(await sequenceIssue(db, "parent"), { field: "id", current: 0, max: 1 });
  await syncSequence(db, "parent");
  assertEquals(await sequenceIssue(db, "parent"), null);
  await db.close();
});

Deno.test("cms.backend.superuser.db.cleanup: API returns targeted row updates", async () => {
  const db = await testDb();
  const node = { app: { db } } as never;

  const maintenance = await cms.node.api(node, { action: "maintenance", maintenance: "check", table: "child" }) as {
    message: string;
    rows: Record<string, string>;
  };
  assertEquals(maintenance.message, "ok");
  assertEquals(maintenance.rows.child.includes('data-table-name="child"'), true);

  const drop = await cms.node.api(node, { action: "drop-table", table: "extra" });
  assertEquals(drop, { message: "Table extra deleted", remove: "extra" });
  assertEquals(db.tables.extra, undefined);
  await db.close();
});
