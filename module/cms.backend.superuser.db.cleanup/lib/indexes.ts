import { sql } from "@qino/qino";

import type { Db } from "@qino/qino";

async function tableIndexes(db: Db, table: string) {
  if (db.dialect === "mysql") {
    const rows = await db.query`SHOW INDEX FROM ${sql.id(table)}`;
    const indexes = new Map<string, { name: string; fields: string[]; primary: boolean; unique: boolean; type: string; safe: boolean; valid: boolean }>();
    for (const row of rows) {
      const name = String(row.Key_name);
      const index = indexes.get(name) ?? {
        name,
        fields: [],
        primary: name === "PRIMARY",
        unique: !Number(row.Non_unique),
        type: String(row.Index_type ?? "").toLowerCase(),
        safe: true,
        valid: true,
      };
      if (row.Column_name == null || row.Sub_part != null || row.Expression != null) index.safe = false;
      else index.fields[Number(row.Seq_in_index) - 1] = String(row.Column_name);
      indexes.set(name, index);
    }
    return [...indexes.values()];
  }
  if (db.dialect === "postgres") {
    const rows = await db.query`
      SELECT ci.relname AS name, ix.indisprimary AS "primary", ix.indisunique AS "unique",
        ix.indisvalid AS valid, am.amname AS type, a.attname AS field, k.ord,
        ix.indexprs IS NOT NULL OR ix.indpred IS NOT NULL OR con.oid IS NOT NULL AS protected
      FROM pg_index ix
      JOIN pg_class tbl ON tbl.oid = ix.indrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      JOIN pg_class ci ON ci.oid = ix.indexrelid
      JOIN pg_am am ON am.oid = ci.relam
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
      LEFT JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attnum = k.attnum
      LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid
      WHERE ns.nspname = current_schema() AND tbl.relname = ${table}
      ORDER BY ci.relname, k.ord`;
    const indexes = new Map<string, { name: string; fields: string[]; primary: boolean; unique: boolean; type: string; safe: boolean; valid: boolean }>();
    for (const row of rows) {
      const name = String(row.name);
      const index = indexes.get(name) ?? {
        name,
        fields: [],
        primary: !!row.primary,
        unique: !!row.unique,
        type: String(row.type ?? "").toLowerCase(),
        safe: !row.protected,
        valid: !!row.valid,
      };
      if (row.field == null) index.safe = false;
      else index.fields[Number(row.ord) - 1] = String(row.field);
      indexes.set(name, index);
    }
    return [...indexes.values()];
  }
  const rows = await db.query`PRAGMA index_list(${sql.id(table)})`;
  return Promise.all(rows.map(async (row) => {
    const name = String(row.name);
    const fields = (await db.query`PRAGMA index_info(${sql.id(name)})`).sort((a, b) => Number(a.seqno) - Number(b.seqno)).map((field) => String(field.name));
    return {
      name,
      fields,
      primary: row.origin === "pk",
      unique: !!row.unique,
      type: "btree",
      safe: row.origin === "c" && !row.partial && fields.every((field) => field !== "null"),
      valid: true,
    };
  }));
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((field, i) => field === b[i]);
const prefix = (a: string[], b: string[]): boolean => a.length <= b.length && a.every((field, i) => field === b[i]);

/** Missing schema/relation indexes and indexes that are safe candidates for removal. */
export async function indexIssues(db: Db, tableName: string) {
  const table = db.tables[tableName];
  if (!table) return [];
  const indexes = await tableIndexes(db, tableName);
  const issues = [];
  const fields = [...table.fields ?? []];
  const wantedPrimary = fields.filter(([, field]) => field.schema["x-index"] === "primary").map(([name]) => name);
  const primary = indexes.find((index) => index.primary);
  const actualPrimary = primary?.fields ?? table.primaries.map(String);
  if (wantedPrimary.length && !same(wantedPrimary, actualPrimary)) {
    issues.push({ kind: "missing", wanted: "primary", actionable: false });
  }
  for (const [field, dbField] of fields) {
    const schemaKind = dbField.schema["x-index"];
    const wanted = schemaKind === "unique" ? "unique" : schemaKind === "fulltext" ? "fulltext" : schemaKind === true || dbField.schema["x-qg-parent"] ? "index" : "";
    if (!wanted || wanted === "fulltext" && db.dialect !== "mysql") continue;
    const found = indexes.some((index) => {
      if (wanted === "unique") return index.unique && same(index.fields, [field]);
      if (wanted === "fulltext") return index.type === "fulltext" && index.fields.includes(field);
      return index.fields[0] === field;
    });
    if (!found) issues.push({ kind: "missing", field, wanted, actionable: true });
  }
  for (const index of indexes) {
    if (!index.valid) issues.push({ kind: "invalid", index: index.name, actionable: db.dialect !== "mysql" });
    if (!index.safe || index.primary || !index.fields.length) continue;
    const duplicate = indexes.find((other) => other !== index && other.name.localeCompare(index.name) < 0 && other.unique === index.unique && other.type === index.type && same(other.fields, index.fields));
    if (duplicate) {
      issues.push({ kind: "duplicate", index: index.name, other: duplicate.name, actionable: !index.unique });
      continue;
    }
    if (index.unique || index.type === "fulltext") continue;
    const covering = indexes.find((other) => other !== index && other.type !== "fulltext" && !same(index.fields, other.fields) && prefix(index.fields, other.fields));
    if (covering) issues.push({ kind: "redundant", index: index.name, other: covering.name, actionable: true });
  }
  return issues;
}

function wantedIndex(db: Db, table: string, field: string): "index" | "unique" | "fulltext" {
  const schema = db.tables[table]?.field(field)?.schema ?? {};
  if (schema["x-index"] === "unique") return "unique";
  if (schema["x-index"] === "fulltext" && db.dialect === "mysql") return "fulltext";
  if (schema["x-index"] === true || schema["x-qg-parent"]) return "index";
  throw new Error("field no longer needs an index");
}

/** Add a currently missing index declared by the schema or a parent relation. */
export async function createMissingIndex(db: Db, table: string, field: string): Promise<void> {
  const issue = (await indexIssues(db, table)).find((issue) => issue.kind === "missing" && issue.field === field && issue.actionable);
  if (!issue) throw new Error("index is no longer missing");
  const wanted = wantedIndex(db, table, field);
  const indexes = await tableIndexes(db, table);
  const base = db.dialect === "mysql" ? field : `idx_${table}_${field}`;
  let name = base;
  for (let i = 2; indexes.some((index) => index.name === name); i++) name = `${base}_${i}`;
  if (db.dialect === "mysql") {
    const kind = sql.raw(wanted === "unique" ? "UNIQUE INDEX" : wanted === "fulltext" ? "FULLTEXT INDEX" : "INDEX");
    await db.exec`ALTER TABLE ${sql.id(table)} ADD ${kind} ${sql.id(name)} (${sql.id(field)})`;
  } else {
    const kind = sql.raw(wanted === "unique" ? "UNIQUE INDEX" : "INDEX");
    await db.exec`CREATE ${kind} ${sql.id(name)} ON ${sql.id(table)} (${sql.id(field)})`;
  }
}

/** Drop an index only while it is still classified as a safe duplicate/redundancy. */
export async function dropRedundantIndex(db: Db, table: string, index: string): Promise<void> {
  const issue = (await indexIssues(db, table)).find((issue) => issue.index === index && issue.actionable && (issue.kind === "duplicate" || issue.kind === "redundant"));
  if (!issue) throw new Error("index is no longer a safe cleanup candidate");
  if (db.dialect === "mysql") await db.exec`ALTER TABLE ${sql.id(table)} DROP INDEX ${sql.id(index)}`;
  else await db.exec`DROP INDEX ${sql.id(index)}`;
}

export async function reindexInvalid(db: Db, table: string, index: string): Promise<void> {
  const issue = (await indexIssues(db, table)).find((issue) => issue.kind === "invalid" && issue.index === index && issue.actionable);
  if (!issue) throw new Error("index is no longer invalid");
  if (db.dialect === "postgres") await db.exec`REINDEX INDEX ${sql.id(index)}`;
  else await db.exec`REINDEX ${sql.id(index)}`;
}
