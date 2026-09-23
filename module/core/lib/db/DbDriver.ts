// deno-lint-ignore-file no-explicit-any
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";

import { mysql, postgres, mysqlDialect, pgDialect, sqliteDialect, schemaToDbMysql, schemaToDbPg, schemaToDbSqlite } from "../../deps.ts";

import type { Pool } from "../../deps.ts";

export type ExecResult = { insertId: number; affectedRows: number };
export type MigrateOptions = { patch?: boolean; force?: boolean };
export type DbDialect = "mysql" | "postgres" | "sqlite";
export type Row = Record<string, any>;

/** Backend abstraction — only the dialect-specific bits live behind this. */
export abstract class DbDriver {
  abstract dialect: DbDialect;
  abstract quoteId(id: string): string;
  /** Receives final dialect SQL (rendered by Db). */
  abstract query(sql: string, params?: unknown[]): Promise<Row[]>;
  abstract exec(sql: string, params?: unknown[], returning?: string): Promise<ExecResult>;
  /** Run fn in a transaction; nested calls join the outer one. */
  abstract transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Set by drivers with a single connection, where work outside a transaction waits for its
   *  commit — see `Db.unit`. */
  oneConnection = false;
  abstract listTables(): Promise<string[]>;
  /** Column metadata in MySQL `SHOW FULL COLUMNS` shape (Field/Type/Null/Key/Default/Extra). */
  abstract columns(table: string): Promise<Row[]>;
  /** Migrate the database to match the given item JSON-schema (dialect-specific DDL). */
  abstract migrate(schema: unknown, opts?: MigrateOptions): Promise<void>;
  /** Idempotent — the underlying pools throw when ended twice. */
  close(): Promise<void> { return this.#closed ? Promise.resolve() : (this.#closed = true, this.closeDriver()); }
  protected abstract closeDriver(): Promise<void>;
  #closed = false;
  /** The engine raises the counter itself when a higher explicit id is inserted. */
  insertSyncsAutoIncrement = true;
  /** Move the id counter past `value` (never down). Only for ids the engine did not see. */
  syncAutoIncrement(_table: string, _field: string, _value: number): Promise<void> { return Promise.resolve(); }
  ensureDatabase(): Promise<void> { return Promise.resolve(); }

  /** Pick a backend from the connection string scheme. */
  static from(conn: string): DbDriver {
    if (conn.startsWith("sqlite:")) return new SqliteDriver(conn.slice("sqlite:".length) || ":memory:");
    if (/^mysql:\/\//i.test(conn)) return new MysqlDriver(conn);
    if (/^postgres(ql)?:\/\//i.test(conn)) return new PostgresDriver(conn);
    throw new Error(`Unsupported database connection string: ${conn || "(empty)"}`);
  }
}

const SQL_MODE = [
  "STRICT_TRANS_TABLES",
  "ONLY_FULL_GROUP_BY",
  "NO_ZERO_IN_DATE",
  "NO_ZERO_DATE",
  "ERROR_FOR_DIVISION_BY_ZERO",
  "NO_ENGINE_SUBSTITUTION",
].join(",");

class MysqlDriver extends DbDriver {
  dialect = "mysql" as const;
  #pool: Pool;
  // A box, not the connection: clearing it on end sends late writes (debounced saves whose ALS
  // context still points here) to the pool instead of a released connection.
  #tx = new AsyncLocalStorage<{ conn: any }>();
  #database: string;
  #connParams: { host: string; port?: number; user: string; password: string };

  constructor(conn: string) {
    super();
    const url = new URL(conn), port = url.port ? Number(url.port) : undefined;
    this.#database = decodeURIComponent(url.pathname.slice(1));
    if (!this.#database) throw new Error(`MySQL connection string needs a database: ${conn}`);
    this.#connParams = { host: url.hostname || "localhost", ...(port && { port }), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
    this.#pool = mysql.createPool({
      ...this.#connParams, database: this.#database,
      charset: "utf8mb4", multipleStatements: false,
      waitForConnections: true, connectionLimit: 8, timezone: "Z",
      // Dates as strings, like the sqlite driver: no Date per row, same shape on every backend.
      dateStrings: true,
      // Per connection; times connectionLimit still far below max_prepared_stmt_count.
      maxPreparedStatements: 200,
    });
    this.#pool.on("connection", (c: { query(sql: string, p?: unknown[]): void }) => c.query("SET SESSION sql_mode = ?", [SQL_MODE]));
  }

  quoteId(id: string) { return mysqlDialect.quoteId(id); }
  #conn() { return this.#tx.getStore()?.conn ?? this.#pool; }
  async query(sql: string, params?: unknown[]) {
    const [res] = await this.#conn().query(sql, params);
    return res as Row[];
  }
  async exec(sql: string, params?: unknown[], _returning?: string) {
    const [res] = await this.#conn().execute(sql, params as any);
    return res as unknown as ExecResult;
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#tx.getStore()?.conn) return fn();
    const conn = await this.#pool.getConnection();
    const box: { conn: any } = { conn };
    await conn.beginTransaction();
    try { const r = await this.#tx.run(box, fn); await conn.commit(); return r; }
    catch (e) { await conn.rollback(); throw e; }
    finally { box.conn = null; conn.release(); }
  }
  async listTables() {
    return (await this.query("SHOW TABLES")).map((r) => Object.values(r)[0]);
  }
  columns(table: string) {
    return this.query(`SHOW FULL COLUMNS FROM ${this.quoteId(table)}`);
  }
  // ALTER TABLE commits an open transaction, but MySQL has no other way to move the counter.
  override async syncAutoIncrement(table: string, _field: string, value: number) {
    await this.exec(`ALTER TABLE ${this.quoteId(table)} AUTO_INCREMENT=${value + 1}`);
  }
  async migrate(schema: unknown, opts: MigrateOptions = {}) {
    await schemaToDbMysql(schema, (sql: string) => this.query(sql), opts);
  }
  override async ensureDatabase() {
    const tmp = mysql.createPool({ ...this.#connParams, charset: "utf8mb4" });
    try {
      await tmp.query(`CREATE DATABASE IF NOT EXISTS ${this.quoteId(this.#database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`);
    } finally {
      await tmp.end();
    }
  }
  protected override closeDriver() { return this.#pool.end(); }
}

// How long a transaction may hold the connection while work waits, before it counts as deadlock.
const STUCK_MS = 30_000;

class SqliteDriver extends DbDriver {
  dialect = "sqlite" as const;
  override oneConnection = true;
  #db: DatabaseSync;
  // One shared connection: during a transaction, outside queries must wait.
  // A box, not a flag: clearing it on end sends late writes (debounced saves whose ALS context
  // still points here) through #chain instead of into the finished transaction.
  #txAls = new AsyncLocalStorage<{ open: boolean }>();
  #chain: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    super();
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON");
    // One sync per commit instead of per write (a request writes session, log, settings…).
    // NORMAL survives a process crash; only power loss can lose the last commits.
    this.#db.exec("PRAGMA journal_mode = WAL");   // ignored for :memory:, which has no journal
    this.#db.exec("PRAGMA synchronous = NORMAL"); // not persistent — set on every connect
  }

  quoteId(id: string) { return sqliteDialect.quoteId(id); }
  // node:sqlite rejects boolean binds; SQLite has no boolean type, so map to 0/1.
  #bind(params: unknown[]) { return params.map((p) => typeof p === "boolean" ? +p : p); }
  #queued = 0;
  // Wait for an open transaction; its own queries (#txAls set) run directly to avoid deadlock.
  // `hold` lets a transaction pass the connection on before it ends — see below.
  #serial<T>(fn: () => T | Promise<T>, hold?: Promise<unknown>): Promise<T> {
    if (this.#txAls.getStore()?.open) return Promise.resolve(fn());
    this.#queued++;
    const run = this.#chain.then(fn, fn);
    const done = run.then(() => {}, () => {});
    this.#chain = hold ? Promise.race([done, hold]) : done;
    done.then(() => this.#queued--);
    return run;
  }
  // Compiling SQL is measurable per request; texts repeat since values are bound. SQLite
  // recompiles cached statements itself when the schema changes.
  #prepared = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  #prepare(sql: string) {
    let stmt = this.#prepared.get(sql);
    if (!stmt) {
      if (this.#prepared.size > 500) this.#prepared.clear(); // limited by code paths, but migrations add more
      this.#prepared.set(sql, stmt = this.#db.prepare(sql));
    }
    return stmt;
  }
  query(sql: string, params: unknown[] = []) {
    return this.#serial(() => this.#prepare(sql).all(...this.#bind(params) as any[]) as Row[]);
  }
  exec(sql: string, params: unknown[] = [], _returning?: string) {
    return this.#serial(() => {
      const r = this.#prepare(sql).run(...this.#bind(params) as any[]);
      return { insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) };
    });
  }
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#txAls.getStore()?.open) return fn(); // nested → join the running transaction
    const box = { open: true };
    let unblock!: () => void;
    const gate = new Promise<void>((r) => unblock = r);
    // Outside work waits for the commit. A transaction awaiting such work waits for itself and
    // blocks everything (what `db.unit` avoids). If it happens anyway, pass the connection on: the
    // waiting work runs inside the transaction and shares its rollback — better than a hang.
    const stuck = setTimeout(() => {
      if (this.#queued < 2) return; // the transaction counts itself
      console.error(`sqlite: transaction open for ${STUCK_MS / 1000}s with ${this.#queued - 1} queries queued behind it — letting them run inside it to break the deadlock; wrap multi-step background work in db.unit()`);
      unblock();
    }, STUCK_MS);
    return this.#serial(() => this.#txAls.run(box, async () => {
      this.#db.exec("BEGIN");
      try { const r = await fn(); this.#db.exec("COMMIT"); return r; }
      catch (e) { this.#db.exec("ROLLBACK"); throw e; }
      finally { box.open = false; clearTimeout(stuck); }
    }), gate);
  }
  async listTables() {
    const rows = await this.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    return rows.map((r) => r.name);
  }
  async columns(table: string) {
    // Map PRAGMA table_info → MySQL SHOW FULL COLUMNS shape so DbField stays dialect-free.
    const rows = await this.query(`PRAGMA table_info(${this.quoteId(table)})`);
    const solo = rows.filter((c) => c.pk).length === 1;
    return rows.map((c) => ({
      Field: c.name,
      Type: c.type || "text",
      Null: c.notnull ? "NO" : "YES",
      Key: c.pk ? "PRI" : "",
      Default: c.dflt_value,
      // Only a sole `INTEGER PRIMARY KEY` is SQLite's auto-incrementing rowid alias.
      Extra: c.pk && solo && /^integer$/i.test(c.type) ? "auto_increment" : "",
    }));
  }
  // Only AUTOINCREMENT tables have a counter; otherwise there is nothing to move.
  override async syncAutoIncrement(table: string, _field: string, value: number) {
    await this.exec("UPDATE sqlite_sequence SET seq = ? WHERE name = ? AND seq < ?", [value, table, value]).catch(() => {});
  }
  async migrate(schema: unknown, opts: MigrateOptions = {}) {
    await schemaToDbSqlite(schema, (sql: string) => this.query(sql), opts);
  }
  protected override closeDriver() { this.#db.close(); return Promise.resolve(); }
}

class PostgresDriver extends DbDriver {
  dialect = "postgres" as const;
  // An explicit id does not advance the sequence, so each such insert needs a sync.
  override insertSyncsAutoIncrement = false;
  #pool: any;
  #tx = new AsyncLocalStorage<{ conn: any }>();
  #database: string;
  #adminParams: Record<string, unknown>;

  constructor(conn: string) {
    super();
    const url = new URL(conn);
    this.#database = decodeURIComponent(url.pathname.slice(1));
    url.pathname = "/postgres";
    this.#adminParams = { connectionString: url.href };
    this.#pool = new postgres.Pool({ connectionString: conn });
  }

  quoteId(id: string) { return pgDialect.quoteId(id); }
  #conn() { return this.#tx.getStore()?.conn ?? this.#pool; }
  async query(sql: string, params?: unknown[]) {
    return (await this.#conn().query(sql, params)).rows as Row[];
  }
  async exec(sql: string, params?: unknown[], returning?: string) {
    let pgSql = sql;
    if (/^\s*insert\b/i.test(pgSql) && !/\breturning\b/i.test(pgSql)) {
      pgSql = pgSql.replace(/;\s*$/, "") + ` RETURNING ${returning ? this.quoteId(returning) : "*"}`;
    }
    const res = await this.#conn().query(pgSql, params);
    const row = res.rows?.[0] ?? {};
    return { insertId: Number(returning ? row[returning] : Object.values(row)[0] ?? 0), affectedRows: Number(res.rowCount ?? 0) };
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#tx.getStore()?.conn) return fn();
    const client = await this.#pool.connect();
    const box: { conn: any } = { conn: client };
    await client.query("BEGIN");
    try { const r = await this.#tx.run(box, fn); await client.query("COMMIT"); return r; }
    catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { box.conn = null; client.release(); }
  }
  // Own connection: setval isn't rolled back anyway and must not fail with the caller's transaction.
  override async syncAutoIncrement(table: string, field: string, value: number) {
    await this.#pool.query(
      `SELECT setval(s::regclass, GREATEST($3, COALESCE(pg_sequence_last_value(s::regclass), 0)), true)
       FROM pg_get_serial_sequence($1, $2) s`,
      [table, field, value],
    );
  }
  async listTables() {
    return (await this.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name",
    )).map((r) => r.table_name);
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
      WHERE c.table_schema = current_schema() AND c.table_name = $1
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
      const max = Number((await this.query(`SELECT MAX(${this.quoteId(auto)}) AS max FROM ${this.quoteId(table)}`))[0]?.max ?? 0);
      if (max) await this.syncAutoIncrement(table, auto, max);
    }
  }
  override async ensureDatabase() {
    if (!this.#database) return;
    const pool = new postgres.Pool(this.#adminParams);
    try {
      const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [this.#database]);
      if (!exists.rowCount) await pool.query(`CREATE DATABASE ${this.quoteId(this.#database)}`);
    } finally {
      await pool.end();
    }
  }
  protected override closeDriver() { return this.#pool.end(); }
}
