import { sql } from "@qino/qino";

import type { Db } from "@qino/qino";

/** Real indexes of a table, per dialect. `safe` marks plain column indexes that cleanup may drop. */
export async function tableIndexes(db: Db, table: string) {
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
