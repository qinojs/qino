import { sql, type Db } from "../../core/mod.ts";

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function nullable(type: unknown): boolean {
  return Array.isArray(type) && type.includes("null");
}

function lengthSql(db: Db, field: string) {
  const fn = sql.raw(db.dialect === "sqlite" ? "LENGTH" : "CHAR_LENGTH");
  return sql`${fn}(${sql.id(field)})`;
}

/** Count values that violate portable, data-level parts of the merged JSON schema. */
export async function validateTable(db: Db, tableName: string) {
  const table = db.tables[tableName];
  if (!table || !(tableName in (db.schema?.properties ?? {}))) throw new Error("table is not covered by the schema");
  const rowSchema = table.schema.additionalProperties ?? {};
  const required = new Set<string>(rowSchema.required ?? []);
  const issues: { field: string; rule: string; count: number }[] = [];
  for (const [field, schema] of Object.entries(rowSchema.properties ?? {})) {
    if (!table.field(field)) continue;
    const props = schema as Record<string, unknown>;
    const ref = sql.id(field);
    const rules: [string, ReturnType<typeof sql>][] = [];
    if (required.has(field) && !nullable(props.type)) rules.push(["required", sql`${ref} IS NULL`]);
    if (Array.isArray(props.enum) && props.enum.length) {
      rules.push(["enum", sql`${ref} IS NOT NULL AND ${ref} NOT IN (${sql.join(props.enum.map((value) => sql`${value}`))})`]);
    }
    if (hasOwn(props, "minLength")) rules.push([`minLength ${props.minLength}`, sql`${ref} IS NOT NULL AND ${lengthSql(db, field)} < ${props.minLength}`]);
    if (hasOwn(props, "maxLength")) rules.push([`maxLength ${props.maxLength}`, sql`${ref} IS NOT NULL AND ${lengthSql(db, field)} > ${props.maxLength}`]);
    if (hasOwn(props, "minimum")) rules.push([`minimum ${props.minimum}`, sql`${ref} IS NOT NULL AND ${ref} < ${props.minimum}`]);
    if (hasOwn(props, "maximum")) rules.push([`maximum ${props.maximum}`, sql`${ref} IS NOT NULL AND ${ref} > ${props.maximum}`]);
    for (const [rule, where] of rules) {
      const count = Number(await db.one`SELECT COUNT(*) FROM ${sql.id(tableName)} WHERE ${where}`);
      if (count) issues.push({ field, rule, count });
    }
  }
  return issues;
}

/** Longest value in a character column — tells whether narrowing it would truncate data. */
export async function longestValue(db: Db, table: string, field: string): Promise<number> {
  return Number(await db.one`SELECT MAX(${lengthSql(db, field)}) FROM ${sql.id(table)}` ?? 0);
}

/** True only if an extra field contains no non-null value. */
export async function isEmptyField(db: Db, table: string, field: string): Promise<boolean> {
  return !await db.one`SELECT 1 FROM ${sql.id(table)} WHERE ${sql.id(field)} IS NOT NULL LIMIT 1`;
}

export async function isEmptyTable(db: Db, table: string): Promise<boolean> {
  return !await db.one`SELECT 1 FROM ${sql.id(table)} LIMIT 1`;
}

export async function sqliteFreeBytes(db: Db): Promise<number | null> {
  if (db.dialect !== "sqlite") return null;
  const pages = Number(await db.one`PRAGMA freelist_count` ?? 0);
  const size = Number(await db.one`PRAGMA page_size` ?? 0);
  return pages * size;
}
