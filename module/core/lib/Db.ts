// deno-lint-ignore-file no-explicit-any
import { mysql, type RowDataPacket } from "../../../deps.ts";
import { type DbDialect, type Driver, type ExecResult, type MigrateOptions, makeDriver } from "./dbDriver.ts";
import { DbTable } from "./DbTable.ts";

export const dateTypes: Record<string, 1> = { DATETIME: 1, DATE: 1, TIMESTAMP: 1 };
export const stringTypes: Record<string, 1> = { CHAR: 1, VARCHAR: 1, BINARY: 1, VARBINARY: 1, BLOB: 1, TEXT: 1, ENUM: 1, SET: 1 };
export const numTypes: Record<string, 1> = { TINYINT: 1, SMALLINT: 1, MEDIUMINT: 1, INT: 1, BIGINT: 1, DECIMAL: 1, FLOAT: 1, DOUBLE: 1 };

export class Db {
  // Backtick identifiers; accepted by both MySQL and SQLite.
  static escapeId = mysql.escapeId;

  #tables: Record<string, DbTable> = {};
  #driver: Driver;
  #schema: Record<string, any> = { properties: {} };
  #events: Record<string, ((data: Record<string, any>) => void | Promise<void>)[]> = {};

  constructor(conn: string) {
    this.#driver = makeDriver(conn);
  }

  get dialect(): DbDialect { return this.#driver.dialect; }
  get emptyInsert(): string { return this.#driver.emptyInsert; }
  get tables(): Record<string, DbTable> { return this.#tables; }
  get schema(): Record<string, any> { return this.#schema; }
  set schema(schema: Record<string, any>) { this.#schema = schema; }

  async #run<T>(fn: () => Promise<T>, sql: string): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      console.error("db: " + (e instanceof Error ? e.message : e) + "\n" + sql.replace(/\s+/g, " "), e);
      throw e;
    }
  }

  query(sql: string, params?: unknown[]): Promise<RowDataPacket[]> {
    return this.#run(() => this.#driver.query(sql, params), sql) as Promise<RowDataPacket[]>;
  }

  exec(sql: string, params?: unknown[], returning?: string): Promise<ExecResult> {
    return this.#run(() => this.#driver.exec(sql, params, returning), sql);
  }
  /** Run fn atomically; nested calls join the outer transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.#driver.transaction(fn);
  }
  syncAutoIncrement(table: string, field: string, value: number): Promise<void> {
    return this.#driver.syncAutoIncrement(table, field, value);
  }

  all = (sql: string, p?: unknown[]): Promise<RowDataPacket[]> => this.query(sql, p);
  row = async (sql: string, p?: unknown[]): Promise<RowDataPacket | undefined> => (await this.query(sql, p))[0];
  col = async (sql: string, p?: unknown[]): Promise<unknown[]> => (await this.query(sql, p)).map((r) => Object.values(r)[0]);
  one = async (sql: string, p?: unknown[]): Promise<unknown> => Object.values(await this.row(sql, p) ?? {})[0];

  async indexCol(sql: string, p?: unknown[]): Promise<Record<string, unknown>> {
    return Object.fromEntries((await this.query(sql, p)).map((r) => Object.values(r) as [string, unknown]));
  }

  /** Create the database if missing. Must run before any schema migration queries against it. */
  ensureDatabase(): Promise<void> {
    return this.#driver.ensureDatabase();
  }

  /** Migrate the database to match an item JSON-schema (dialect-specific DDL). */
  migrate(schema: unknown, opts?: MigrateOptions): Promise<void> {
    return this.#driver.migrate(schema, opts);
  }

  /** Column metadata for a table, in MySQL `SHOW FULL COLUMNS` shape. */
  columns(table: string): Promise<Record<string, any>[]> {
    return this.#driver.columns(table);
  }

  /** Introspect the current tables into memory. Run after the schema is migrated. */
  async loadTables(): Promise<void> {
    const tables = await this.#driver.listTables();
    this.#tables = {};
    for (const table of tables) {
      this.#tables[table] = new DbTable(this, table);
      await this.#tables[table].init();
    }
  }

  table(name: string): DbTable { return this.#tables[name]; }
  escapeId(id: string): string { return this.#driver.escapeId(id); }

  close = (): Promise<void> => this.#driver.close();

  on(name: string, fn: (data: Record<string, any>) => void | Promise<void>): void {
    (this.#events[name] ??= []).push(fn);
  }
  async fire(name: string, data: Record<string, any> = {}): Promise<void> {
    if (!this.#events[name]) return;
    data["event_type"] = name;
    for (const fn of this.#events[name]) await fn(data);
  }

  static quote(v: unknown): string {
    if (v == null) return "NULL";
    return `'${String(v).replace(/[\0\b\t\n\r'"\\]/g, c => ({
      "\0": "\\0", "\b": "\\b", "\t": "\\t", "\n": "\\n",
      "\r": "\\r", "'": "\\'", '"': '\\"', "\\": "\\\\",
    }[c]!))}'`;
  }

}
