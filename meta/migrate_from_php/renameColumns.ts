import { sql } from "@qino/qino";

import type { App, Db } from "@qino/qino";

/** Renames that have to happen before the schema migration sees the table. It is additive and can
 *  only add, so a column renamed in the schema would otherwise arrive as a new empty one beside the
 *  full old one — and in `patch` mode the old one is never dropped again. */
const columns: [table: string, old: string, current: string][] = [
  // `usr.email` is only the login handle since `usr_contact` holds the addresses; the rest
  // follow the spelling OIDC, SCIM and vCard share — an `organization` is not always a company.
  ["usr", "email", "username"],
  ["usr", "firstname", "given_name"],
  ["usr", "lastname", "family_name"],
  ["usr", "company", "organization"],
];

/** Bring an existing database up to what this qino expects, before `app.init()` migrates the
 *  schema against it. Idempotent, and silent on a database that does not exist yet. */
export async function migrate(app: App): Promise<void> {
  for (const table of new Set(columns.map(([of]) => of))) {
    // cms.versions mirrors a table column by column, so the mirror is renamed along with it
    for (const t of [table, "_vers_" + table]) {
      const have = await columnsOf(app.db, t);
      if (!have.size) continue;
      for (const [, old, current] of columns.filter(([of]) => of === table)) {
        if (!have.has(old)) continue;
        // Booted once before this ran? Then the migration already put the new column there, empty.
        // Carrying the values over and dropping the old one is the same rename, one step later.
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
  // SQLite and PostgreSQL refuse to drop a column an index still names; MySQL drops the
  // single-column index along with it. The schema engine names them idx_<table>_<column>.
  if (db.dialect !== "mysql") await db.query`DROP INDEX IF EXISTS ${sql.id(`idx_${table}_${old}`)}`;
  await db.query`ALTER TABLE ${sql.id(table)} DROP COLUMN ${sql.id(old)}`;
}

/** What the table has, empty for one that is not there — asking the catalogue rather than the table,
 *  so a miss is an empty answer instead of a failed query in the log. A database that has yet to be
 *  created cannot answer at all, and says the same. */
async function columnsOf(db: Db, table: string): Promise<Set<string>> {
  // information_schema spans every database on the server — without the scope, a table of the same
  // name in a neighbouring installation would answer for this one.
  const scope = db.dialect === "mysql" ? sql`DATABASE()` : sql`current_schema()`;
  const rows = await (db.dialect === "sqlite"
    ? db.query`SELECT name FROM pragma_table_info(${table})`
    : db.query`SELECT column_name AS name FROM information_schema.columns
        WHERE table_schema = ${scope} AND table_name = ${table}`)
    .catch(() => []);
  return new Set(rows.map((row) => String(row.name)));
}
