import { sql } from "@qino/qino";

import type { Db, DbField } from "@qino/qino";
import type { TableStatus } from "@qino/qino/cms.backend.superuser.db";

const DELETE_BATCH = 1000;
const REPAIR_ENGINES = new Set(["archive", "aria", "csv", "myisam"]);

function relation(db: Db, tableName: string, fieldName: string) {
  const table = db.tables[tableName];
  const field = table?.field(fieldName);
  const parentName = String(field?.schema["x-qg-parent"] ?? "");
  const parent = db.tables[parentName];
  const parentFieldName = String(field?.schema["x-qg-parent-field"] ?? parent?.primary?.name ?? "");
  const parentField = parent?.field(parentFieldName);
  return table && field && parent && parentField ? { table, field, parent, parentField } : undefined;
}

function orphanWhere(field: DbField, parentField: DbField) {
  const child = sql`${sql.id("child")}.${sql.id(field.name)}`;
  const parent = sql`${sql.id("parent")}.${sql.id(parentField.name)}`;
  const equal = field.db.dialect === "mysql" && field.collate && parentField.collate && field.collate !== parentField.collate
    ? sql`BINARY ${parent} = BINARY ${child}`
    : sql`${parent} = ${child}`;
  return sql`${child} IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ${sql.id(parentField.table)} ${sql.id("parent")}
    WHERE ${equal}
  )`;
}

/** Broken x-qg-parent relations that declare a cleanup rule, with a few entry ids for review. */
export async function findOrphans(db: Db, tableName?: string) {
  const relations = [];
  for (const table of Object.values(db.tables)) {
    if (tableName && table.name !== tableName) continue;
    for (const field of Object.values(table.fields ?? {})) {
      if (field.onParentDelete !== "cascade" && field.onParentDelete !== "setnull") continue; // no rule: dangling ids are fine (e.g. purged log rows)
      const r = relation(db, table.name, field.name);
      if (r) relations.push(r);
    }
  }
  const issues = await Promise.all(relations.map(async ({ table, field, parent, parentField }) => {
    const where = orphanWhere(field, parentField);
    const count = Number(await db.one`SELECT COUNT(*) FROM ${sql.id(table)} ${sql.id("child")} WHERE ${where}`);
    if (!count) return null;
    const rows = await db.query`SELECT ${sql.id("child")}.* FROM ${sql.id(table)} ${sql.id("child")} WHERE ${where} LIMIT 5`;
    const parentEmpty = !await db.one`SELECT 1 FROM ${sql.id(parent)} LIMIT 1`;
    const blocked = !table.primaries.length
      ? "table has no primary key"
      : field.onParentDelete === "setnull" && !field.null
      ? "field is NOT NULL"
      : "";
    return {
      table: table.name,
      field: field.name,
      parent: parent.name,
      parentField: parentField.name,
      onDelete: field.onParentDelete,
      count,
      parentEmpty,
      samples: rows.map((row) => table.entryId(row)).filter((id) => id !== undefined),
      actionable: !blocked,
      blocked,
    };
  }));
  return issues.filter((issue) => issue !== null);
}

/** Apply the relation's declared parent-delete rule to one safe batch. */
export async function cleanOrphans(db: Db, tableName: string, fieldName: string) {
  const r = relation(db, tableName, fieldName);
  if (!r) throw new Error("relation no longer exists");
  if (!r.table.primaries.length) throw new Error("table has no primary key");
  if (r.field.onParentDelete !== "cascade" && r.field.onParentDelete !== "setnull") throw new Error("relation has no cleanup rule");
  if (r.field.onParentDelete === "setnull" && !r.field.null) throw new Error("field cannot be set to null");
  const where = orphanWhere(r.field, r.parentField);
  const rows = await db.query`SELECT ${sql.id("child")}.* FROM ${sql.id(r.table)} ${sql.id("child")} WHERE ${where} LIMIT ${sql.raw(String(DELETE_BATCH))}`;
  let cleaned = 0;
  await db.transaction(async () => {
    for (const row of rows) {
      const done = r.field.onParentDelete === "cascade"
        ? await r.table.delete(row)
        : await r.table.update(row, { [r.field.name]: null });
      if (done) cleaned++;
    }
  });
  const remaining = Number(await db.one`SELECT COUNT(*) FROM ${sql.id(r.table)} ${sql.id("child")} WHERE ${where}`);
  return { cleaned, remaining, action: r.field.onParentDelete };
}

/** Where database and schema drifted apart: leftovers, and columns wider than the schema needs. */
export function schemaExtras(db: Db) {
  const schema = db.schema?.properties ?? {};
  const issues = [];
  for (const [table, dbTable] of Object.entries(db.tables)) {
    if (!(table in schema)) { issues.push({ table, status: "no-schema-table" }); continue; }
    const fields = schema[table].additionalProperties?.properties ?? {};
    for (const [field, dbField] of Object.entries(dbTable.fields ?? {})) {
      if (!(field in fields)) { issues.push({ table, field, status: "field-missing-schema" }); continue; }
      // The migration only ever widens, so a column can outgrow its schema and stay that way.
      // Only declared character lengths are comparable — an integer width is a different question.
      const current = Number(dbField.length), required = Number(fields[field].maxLength);
      if (/char|text|binary|blob/.test(dbField.type) && current > required) {
        issues.push({ table, field, status: "field-oversized", current, required });
      }
    }
  }
  return issues;
}

export async function dropExtraTable(db: Db, tableName: string): Promise<void> {
  if (!db.tables[tableName] || tableName in (db.schema?.properties ?? {})) throw new Error("table is no longer outside the schema");
  await db.exec`DROP TABLE ${sql.id(tableName)}`;
  await db.loadTables();
}

export async function dropExtraField(db: Db, tableName: string, fieldName: string): Promise<void> {
  const table = db.tables[tableName];
  const fields = db.schema?.properties?.[tableName]?.additionalProperties?.properties ?? {};
  if (!table?.field(fieldName) || fieldName in fields) throw new Error("field is no longer outside the schema");
  await db.exec`ALTER TABLE ${sql.id(tableName)} DROP COLUMN ${sql.id(fieldName)}`;
  await table.reloadFields();
}

export function maintenanceActions(db: Db, status: TableStatus): string[] {
  if (db.dialect === "mysql") {
    const actions = ["check", "analyze", "optimize"];
    if (REPAIR_ENGINES.has(status.engine.toLowerCase())) actions.push("repair");
    return actions;
  }
  if (db.dialect === "postgres") return ["analyze", "optimize", "reindex"];
  return ["check", "analyze", "reindex"];
}

const resultText = (rows: Record<string, unknown>[]): string => rows.map((row) => {
  const type = row.Msg_type ?? row.msg_type ?? "";
  const text = row.Msg_text ?? row.msg_text ?? Object.values(row).at(-1) ?? "done";
  return type ? `${type}: ${text}` : String(text);
}).join("\n");

export async function maintain(db: Db, action: string, tableName: string, status: TableStatus): Promise<string> {
  if (!db.tables[tableName]) throw new Error("table no longer exists");
  if (!maintenanceActions(db, status).includes(action)) throw new Error("action is not supported for this table");

  if (db.dialect === "mysql") {
    if (action === "check") return resultText(await db.query`CHECK TABLE ${sql.id(tableName)}`);
    if (action === "analyze") return resultText(await db.query`ANALYZE TABLE ${sql.id(tableName)}`);
    if (action === "optimize") return resultText(await db.query`OPTIMIZE TABLE ${sql.id(tableName)}`);
    return resultText(await db.query`REPAIR TABLE ${sql.id(tableName)}`);
  }
  if (db.dialect === "postgres") {
    if (action === "analyze") await db.exec`ANALYZE ${sql.id(tableName)}`;
    else if (action === "optimize") await db.exec`VACUUM (ANALYZE) ${sql.id(tableName)}`;
    else await db.exec`REINDEX TABLE ${sql.id(tableName)}`;
    return "done";
  }
  if (action === "check") return resultText(await db.query`PRAGMA integrity_check(${sql.id(tableName)})`);
  if (action === "analyze") await db.exec`ANALYZE ${sql.id(tableName)}`;
  else await db.exec`REINDEX ${sql.id(tableName)}`;
  return "done";
}
