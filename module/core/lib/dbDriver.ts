// deno-lint-ignore-file no-explicit-any
import { mysql, type Pool, schemaToDbMysql, schemaToDbSqlite } from "../../../deps.ts";
import { DatabaseSync } from "node:sqlite";

export interface ExecResult { insertId: number; affectedRows: number; }
export interface MigrateOptions { patch?: boolean; force?: boolean; }

/** Backend abstraction — only the dialect-specific bits live behind this. */
export interface Driver {
  query(sql: string, params?: unknown[]): Promise<Record<string, any>[]>;
  exec(sql: string, params?: unknown[]): Promise<ExecResult>;
  listTables(): Promise<string[]>;
  /** Column metadata in MySQL `SHOW FULL COLUMNS` shape (Field/Type/Null/Key/Default/Extra). */
  columns(table: string): Promise<Record<string, any>[]>;
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

/** Pick a backend from the connection string scheme: `sqlite:<path>` else mysql. */
export function makeDriver(conn: string, user: string, pass: string): Driver {
  if (conn.startsWith("sqlite:")) return new SqliteDriver(conn.slice("sqlite:".length) || ":memory:");
  return new MysqlDriver(conn, user, pass);
}

class MysqlDriver implements Driver {
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

  async query(sql: string, params?: unknown[]) {
    const [res] = await this.#pool.query(sql, params);
    return res as Record<string, any>[];
  }
  async exec(sql: string, params?: unknown[]) {
    const [res] = await this.#pool.execute(sql, params as any);
    return res as unknown as ExecResult;
  }
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
  #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON");
  }

  query(sql: string, params: unknown[] = []) {
    return Promise.resolve(this.#db.prepare(sql).all(...params as any[]) as Record<string, any>[]);
  }
  exec(sql: string, params: unknown[] = []) {
    const r = this.#db.prepare(sql).run(...params as any[]);
    return Promise.resolve({ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) });
  }
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
