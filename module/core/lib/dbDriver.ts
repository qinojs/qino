// deno-lint-ignore-file no-explicit-any
import { mysql, postgres, type Pool, schemaToDbMysql, schemaToDbPg, schemaToDbSqlite } from "../../../deps.ts";
import { DatabaseSync } from "node:sqlite";

export interface ExecResult { insertId: number; affectedRows: number; }
export interface MigrateOptions { patch?: boolean; force?: boolean; }
export type DbDialect = "mysql" | "postgres" | "sqlite";
type Row = Record<string, any>;

/** Backend abstraction — only the dialect-specific bits live behind this. */
export interface Driver {
  dialect: DbDialect;
  emptyInsert: string;
  escapeId(id: string): string;
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  exec(sql: string, params?: unknown[], returning?: string): Promise<ExecResult>;
  syncAutoIncrement(table: string, field: string, value: number): Promise<void>;
  listTables(): Promise<string[]>;
  /** Column metadata in MySQL `SHOW FULL COLUMNS` shape (Field/Type/Null/Key/Default/Extra). */
  columns(table: string): Promise<Row[]>;
  /** Migrate the database to match the given item JSON-schema (dialect-specific DDL). */
  migrate(schema: unknown, opts?: MigrateOptions): Promise<void>;
  ensureDatabase(): Promise<void>;
  close(): Promise<void>;
}

const sqlMode = [
  "ONLY_FULL_GROUP_BY",
  "NO_ZERO_IN_DATE",
  "NO_ZERO_DATE",
  "ERROR_FOR_DIVISION_BY_ZERO",
  "NO_ENGINE_SUBSTITUTION",
].join(",");

/** Pick a backend from the connection string scheme: `sqlite:`, `postgres:`/`postgresql:`, else mysql. */
export function makeDriver(conn: string, user: string, pass: string): Driver {
  if (conn.startsWith("sqlite:")) return new SqliteDriver(conn.slice("sqlite:".length) || ":memory:");
  if (/^postgres(ql)?:/i.test(conn)) return new PostgresDriver(conn, user, pass);
  return new MysqlDriver(conn, user, pass);
}

class MysqlDriver implements Driver {
  dialect = "mysql" as const;
  emptyInsert = "() VALUES ()";
  #pool: Pool;
  #database: string;
  #connParams: { host: string; user: string; password: string };

  constructor(conn: string, user: string, pass: string) {
    const [, host = "localhost"] = conn.match(/host=([^;]+)/) ?? [];
    const [, database = user] = conn.match(/dbname=([^;]+)/) ?? [];
    this.#database = database;
    this.#connParams = { host, user, password: pass };
    this.#pool = mysql.createPool({
      host, user, password: pass, database,
      charset: "utf8mb4", multipleStatements: false,
      waitForConnections: true, connectionLimit: 4, timezone: "Z",
    });
    this.#pool.on("connection", (c: { query(sql: string, p?: unknown[]): void }) => c.query("SET SESSION sql_mode = ?", [sqlMode]));
  }

  escapeId(id: string) { return mysql.escapeId(id); }
  async query(sql: string, params?: unknown[]) {
    const [res] = await this.#pool.query(sql, params);
    return res as Row[];
  }
  async exec(sql: string, params?: unknown[], _returning?: string) {
    const [res] = await this.#pool.execute(sql, params as any);
    return res as unknown as ExecResult;
  }
  syncAutoIncrement(_table: string, _field: string, _value: number) { return Promise.resolve(); }
  async listTables() {
    return (await this.query("SHOW TABLES")).map((r) => Object.values(r)[0] as string);
  }
  columns(table: string) {
    return this.query(`SHOW FULL COLUMNS FROM ${mysql.escapeId(table)}`);
  }
  async migrate(schema: unknown, opts: MigrateOptions = {}) {
    await schemaToDbMysql(schema, (sql: string) => this.query(sql), opts);
  }
  async ensureDatabase() {
    const tmp = mysql.createPool({ ...this.#connParams, charset: "utf8mb4" });
    try {
      await tmp.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(this.#database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`);
    } finally {
      await tmp.end();
    }
  }
  close() { return this.#pool.end(); }
}

class SqliteDriver implements Driver {
  dialect = "sqlite" as const;
  emptyInsert = "DEFAULT VALUES";
  #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON");
  }

  escapeId(id: string) { return mysql.escapeId(id); }
  query(sql: string, params: unknown[] = []) {
    return Promise.resolve(this.#db.prepare(sql).all(...params as any[]) as Row[]);
  }
  exec(sql: string, params: unknown[] = [], _returning?: string) {
    const r = this.#db.prepare(sql).run(...params as any[]);
    return Promise.resolve({ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) });
  }
  syncAutoIncrement(_table: string, _field: string, _value: number) { return Promise.resolve(); }
  listTables() {
    return this.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .then((rows) => rows.map((r) => r.name as string));
  }
  columns(table: string) {
    // Map PRAGMA table_info → MySQL SHOW FULL COLUMNS shape so DbField stays dialect-free.
    return this.query(`PRAGMA table_info(${mysql.escapeId(table)})`).then((rows) => rows.map((c) => ({
      Field: c.name,
      Type: c.type || "text",
      Null: c.notnull ? "NO" : "YES",
      Key: c.pk ? "PRI" : "",
      Default: c.dflt_value,
      // INTEGER PRIMARY KEY is SQLite's auto-incrementing rowid alias.
      Extra: c.pk && /int/i.test(c.type) ? "auto_increment" : "",
    })));
  }
  async migrate(schema: unknown, opts: MigrateOptions = {}) {
    await schemaToDbSqlite(schema, (sql: string) => this.query(sql), opts);
  }
  ensureDatabase() { return Promise.resolve(); }
  close() { this.#db.close(); return Promise.resolve(); }
}

/** TEMPORARY: Convert Qino's MySQL-compatible SQL surface to PostgreSQL syntax outside strings/comments. */
export function toPostgresSql(sql: string): string {
  let out = "", param = 0, quote = "", line = false, block = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (line) {
      out += c;
      if (c === "\n") line = false;
      continue;
    }
    if (block) {
      out += c;
      if (c === "*" && n === "/") { out += n; i++; block = false; }
      continue;
    }
    if (quote) {
      if (quote === "`") {
        if (c === "`") {
          if (n === "`") { out += "\"\""; i++; }
          else { out += '"'; quote = ""; }
        } else out += c === '"' ? '""' : c;
        continue;
      }
      if (quote === "'" && c === "\\" && n) {
        const escaped: Record<string, string> = { "'": "''", "\\": "\\", "0": "\0", b: "\b", t: "\t", n: "\n", r: "\r" };
        out += escaped[n] ?? n;
        i++;
        continue;
      }
      out += c;
      if (c === quote) {
        if (n === quote) { out += n; i++; }
        else quote = "";
      } else if (c === "\\" && n) out += sql[++i];
      continue;
    }
    if (c === "-" && n === "-") { out += c + n; i++; line = true; continue; }
    if (c === "/" && n === "*") { out += c + n; i++; block = true; continue; }
    if (c === "'" || c === '"') { out += c; quote = c; continue; }
    if (c === "`") { out += '"'; quote = c; continue; }
    if (c === "?") { out += "$" + ++param; continue; }
    out += c;
  }
  return out
    .replace(/\bINT\s*\(\s*\d+\s*\)/gi, "BIGINT")
    .replace(/\bDATETIME\b/gi, "TIMESTAMP");
}

function pgParams(conn: string, user: string, password: string): Record<string, unknown> {
  if (/^postgres(ql)?:\/\//i.test(conn)) return { connectionString: conn };
  const ret: Record<string, unknown> = { user, password };
  for (const part of conn.replace(/^postgres(ql)?:/i, "").split(";")) {
    const [key, ...value] = part.split("=");
    if (!value.length) continue;
    const name = key === "dbname" ? "database" : key;
    ret[name] = value.join("=");
  }
  return ret;
}

class PostgresDriver implements Driver {
  dialect = "postgres" as const;
  emptyInsert = "DEFAULT VALUES";
  #pool: any;
  #database: string;
  #adminParams: Record<string, unknown>;

  constructor(conn: string, user: string, pass: string) {
    const params = pgParams(conn, user, pass);
    if (params.connectionString) {
      const url = new URL(String(params.connectionString));
      this.#database = decodeURIComponent(url.pathname.slice(1));
      url.pathname = "/postgres";
      this.#adminParams = { connectionString: url.href };
    } else {
      this.#database = String(params.database ?? "");
      this.#adminParams = { ...params, database: "postgres" };
    }
    this.#pool = new postgres.Pool(params);
  }

  escapeId(id: string) { return `"${id.replaceAll('"', '""')}"`; }
  async query(sql: string, params?: unknown[]) {
    return (await this.#pool.query(toPostgresSql(sql), params)).rows as Row[];
  }
  async exec(sql: string, params?: unknown[], returning?: string) {
    let pgSql = toPostgresSql(sql);
    if (/^\s*insert\b/i.test(pgSql) && !/\breturning\b/i.test(pgSql)) {
      pgSql = pgSql.replace(/;\s*$/, "") + ` RETURNING ${returning ? this.escapeId(returning) : "*"}`;
    }
    const res = await this.#pool.query(pgSql, params);
    const row = res.rows?.[0] ?? {};
    return { insertId: Number(returning ? row[returning] : Object.values(row)[0] ?? 0), affectedRows: Number(res.rowCount ?? 0) };
  }
  async syncAutoIncrement(table: string, field: string, value: number) {
    if (value < 1) return;
    const column = this.escapeId(field), tbl = this.escapeId(table);
    await this.#pool.query(
      `SELECT setval(pg_get_serial_sequence($1, $2), GREATEST($3, (SELECT COALESCE(MAX(${column}), 0) FROM ${tbl})), true)`,
      [table, field, value],
    );
  }
  async listTables() {
    return (await this.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name",
    )).map((r) => r.table_name as string);
  }
  columns(table: string) {
    return this.query(`
      SELECT c.column_name AS "Field",
        CASE c.data_type
          WHEN 'integer' THEN 'int'
          WHEN 'boolean' THEN 'boolean'
          WHEN 'character varying' THEN 'varchar(' || c.character_maximum_length || ')'
          WHEN 'character' THEN 'char(' || c.character_maximum_length || ')'
          WHEN 'timestamp without time zone' THEN 'datetime'
          WHEN 'timestamp with time zone' THEN 'timestamp'
          WHEN 'bytea' THEN 'blob'
          ELSE c.data_type
        END AS "Type",
        CASE c.is_nullable WHEN 'YES' THEN 'YES' ELSE 'NO' END AS "Null",
        CASE WHEN EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
            AND kcu.constraint_schema = tc.constraint_schema AND kcu.table_name = tc.table_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema
            AND tc.table_name = c.table_name AND kcu.column_name = c.column_name
        ) THEN 'PRI' ELSE '' END AS "Key",
        c.column_default AS "Default",
        CASE WHEN c.is_identity = 'YES' OR c.column_default LIKE 'nextval(%' THEN 'auto_increment' ELSE '' END AS "Extra"
      FROM information_schema.columns c
      WHERE c.table_schema = current_schema() AND c.table_name = ?
      ORDER BY c.ordinal_position
    `, [table]);
  }
  async migrate(schema: any, opts: MigrateOptions = {}) {
    await schemaToDbPg(schema, (sql: string) => this.query(sql), opts);
    await this.#syncAutoIncrements(schema);
  }
  async #syncAutoIncrements(schema: any) {
    for (const [table, tableSchema] of Object.entries(schema?.properties ?? {}) as [string, any][]) {
      const fields = tableSchema.additionalProperties?.properties ?? {};
      const auto = Object.entries(fields).find(([, field]: any) => field["x-autoincrement"])?.[0];
      if (!auto) continue;
      const max = Number((await this.query(`SELECT MAX(${this.escapeId(auto)}) AS max FROM ${this.escapeId(table)}`))[0]?.max ?? 0);
      if (max) await this.syncAutoIncrement(table, auto, max);
    }
  }
  async ensureDatabase() {
    if (!this.#database) return;
    const pool = new postgres.Pool(this.#adminParams);
    try {
      const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [this.#database]);
      if (!exists.rowCount) await pool.query(`CREATE DATABASE ${this.escapeId(this.#database)}`);
    } finally {
      await pool.end();
    }
  }
  close() { return this.#pool.end(); }
}
