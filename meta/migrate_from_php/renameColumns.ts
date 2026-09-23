import { sql } from "@qino/qino";

import type { App, Db } from "@qino/qino";

/** Renames that must happen before the schema migration, which only adds: a renamed column would
 *  appear as a new empty column next to the old one (never dropped in `patch` mode). */
const columns: [table: string, old: string, current: string][] = [
  // `usr.email` is only the login name now (addresses are in `usr_contact`); the others follow
  // OIDC/SCIM/vCard naming.
  ["usr", "email", "username"],
  ["usr", "firstname", "given_name"],
  ["usr", "lastname", "family_name"],
  ["usr", "company", "organization"],
];

/** Update an existing database before `app.init()` migrates the schema. Idempotent; does nothing
 *  if the database doesn't exist yet. */
export async function migrate(app: App): Promise<void> {
  for (const table of new Set(columns.map(([of]) => of))) {
    // cms.versions mirrors a table column by column, so the mirror is renamed along with it
    for (const t of [table, "_vers_" + table]) {
      const have = await columnsOf(app.db, t);
      if (!have.size) continue;
      for (const [, old, current] of columns.filter(([of]) => of === table)) {
        if (!have.has(old)) continue;
        // If the app booted before, the new column exists empty: copy the values and drop the old one.
        if (have.has(current)) await carryOver(app.db, t, old, current);
        else await app.db.query`ALTER TABLE ${sql.id(t)} RENAME COLUMN ${sql.id(old)} TO ${sql.id(current)}`;
        console.log(`[migrate] ${t}.${old} → ${current}`);
      }
    }
  }
}

async function carryOver(db: Db, table: string, old: string, current: string): Promise<void> {
  const set = sql`${sql.id(current)} = ${sql.id(old)}`;
  await db.query`UPDATE ${sql.id(table)} SET ${set} WHERE ${sql.id(current)} IS NULL OR ${sql.id(current)} = ${""}`;
  // SQLite and PostgreSQL can't drop an indexed column (MySQL drops the index too). Indexes are
  // named idx_<table>_<column>.
  if (db.dialect !== "mysql") await db.query`DROP INDEX IF EXISTS ${sql.id(`idx_${table}_${old}`)}`;
  await db.query`ALTER TABLE ${sql.id(table)} DROP COLUMN ${sql.id(old)}`;
}

/** The table's columns, empty if the table (or database) doesn't exist — asks the catalog, so no
 *  failed query is logged. */
async function columnsOf(db: Db, table: string): Promise<Set<string>> {
  // information_schema covers all databases, so restrict to this one.
  const scope = db.dialect === "mysql" ? sql`DATABASE()` : sql`current_schema()`;
  const rows = await (db.dialect === "sqlite"
    ? db.query`SELECT name FROM pragma_table_info(${table})`
    : db.query`SELECT column_name AS name FROM information_schema.columns
        WHERE table_schema = ${scope} AND table_name = ${table}`)
    .catch(() => []);
  return new Set(rows.map((row) => String(row.name)));
}
