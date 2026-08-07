import { sql, type Db } from "../../core/mod.ts";

/** Auto-id sequence that would generate an id already present in the table. */
export async function sequenceIssue(db: Db, tableName: string) {
  const table = db.tables[tableName];
  const field = table?.autoIncrement;
  if (!field) return null;
  const max = Number(await db.one`SELECT MAX(${sql.id(field)}) FROM ${sql.id(tableName)}` ?? 0);
  if (!max) return null;
  let current: number | null = null;
  if (db.dialect === "mysql") {
    const status = await db.row`SHOW TABLE STATUS LIKE ${tableName}`;
    current = status?.Auto_increment != null ? Number(status.Auto_increment) - 1 : null;
  } else if (db.dialect === "postgres") {
    const value = await db.one`
      SELECT s.last_value
      FROM pg_sequences s
      WHERE s.schemaname = current_schema()
        AND format('%I.%I', s.schemaname, s.sequencename) = pg_get_serial_sequence(${tableName}, ${String(field)})`;
    current = value != null ? Number(value) : null;
  } else {
    const value = await db.one`SELECT seq FROM sqlite_sequence WHERE name = ${tableName}`.catch(() => null);
    current = value != null ? Number(value) : null;
  }
  return current != null && current < max ? { field: String(field), current, max } : null;
}

/** Move a verified auto-id sequence to the table's current maximum id. */
export async function syncSequence(db: Db, tableName: string): Promise<void> {
  const issue = await sequenceIssue(db, tableName);
  if (!issue) throw new Error("auto-id sequence is no longer behind");
  await db.syncAutoIncrement(tableName, issue.field, issue.max);
}
