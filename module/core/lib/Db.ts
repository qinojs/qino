// deno-lint-ignore-file no-explicit-any
import { mysql, type RowDataPacket } from "../../../deps.ts";
import { type DbDialect, type Driver, type ExecResult, type MigrateOptions, makeDriver } from "./dbDriver.ts";
import { DbTable } from "./DbTable.ts";
import { sql, isTemplate, render, type Sql } from "../../../deps.ts";

export const dateTypes: Record<string, 1> = { DATETIME: 1, DATE: 1, TIMESTAMP: 1 };
export const stringTypes: Record<string, 1> = { CHAR: 1, VARCHAR: 1, BINARY: 1, VARBINARY: 1, BLOB: 1, TEXT: 1, ENUM: 1, SET: 1 };
export const numTypes: Record<string, 1> = { TINYINT: 1, SMALLINT: 1, MEDIUMINT: 1, INT: 1, BIGINT: 1, DECIMAL: 1, FLOAT: 1, DOUBLE: 1 };

export class Db {
  // Backtick identifiers; accepted by both MySQL and SQLite.
  static escapeId = mysql.escapeId;

  #tables: Record<string, DbTable> = {};
  #driver: Driver;
  #dialect: { quoteId(id: string): string; placeholder(n: number): string };
  #schema: Record<string, any> = { properties: {} };
  #events: Record<string, ((data: Record<string, any>) => void | Promise<void>)[]> = {};

  constructor(conn: string) {
    this.#driver = makeDriver(conn);
    this.#dialect = {
      quoteId: (id) => this.#driver.escapeId(id),
      placeholder: (n) => this.#driver.placeholder(n),
    };
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

  /** Render a fragment / tag to this dialect's [sql, params]. */
  #sql(a: TemplateStringsArray | Sql, rest: unknown[]): [string, unknown[]] {
    const frag = isTemplate(a) ? sql(a, ...rest) : a;
    const { text, params } = render(frag, this.#dialect);
    return [text, params];
  }

  query(strings: TemplateStringsArray, ...values: unknown[]): Promise<RowDataPacket[]>;
  query(frag: Sql): Promise<RowDataPacket[]>;
  query(a: TemplateStringsArray | Sql, ...rest: unknown[]): Promise<RowDataPacket[]> {
    const [text, params] = this.#sql(a, rest);
    return this.#run(() => this.#driver.query(text, params), text) as Promise<RowDataPacket[]>;
  }

  exec(strings: TemplateStringsArray, ...values: unknown[]): Promise<ExecResult>;
  exec(frag: Sql, returning?: string): Promise<ExecResult>;
  exec(a: TemplateStringsArray | Sql, ...rest: unknown[]): Promise<ExecResult> {
    const returning = isTemplate(a) ? undefined : rest[0] as string;
    const [text, params] = this.#sql(a, rest);
    return this.#run(() => this.#driver.exec(text, params, returning), text);
  }
  /** Run fn atomically; nested calls join the outer transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.#driver.transaction(fn);
  }
  syncAutoIncrement(table: string, field: string, value: number): Promise<void> {
    return this.#driver.syncAutoIncrement(table, field, value);
  }

  all(strings: TemplateStringsArray, ...values: unknown[]): Promise<RowDataPacket[]>;
  all(frag: Sql): Promise<RowDataPacket[]>;
  all(a: any, ...rest: any[]): Promise<RowDataPacket[]> { return (this.query as any)(a, ...rest); }

  row(strings: TemplateStringsArray, ...values: unknown[]): Promise<RowDataPacket | undefined>;
  row(frag: Sql): Promise<RowDataPacket | undefined>;
  async row(a: any, ...rest: any[]): Promise<RowDataPacket | undefined> { return (await (this.query as any)(a, ...rest))[0]; }

  col(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  col(frag: Sql): Promise<unknown[]>;
  async col(a: any, ...rest: any[]): Promise<unknown[]> { return (await (this.query as any)(a, ...rest)).map((r: RowDataPacket) => Object.values(r)[0]); }

  one(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  one(frag: Sql): Promise<unknown>;
  async one(a: any, ...rest: any[]): Promise<unknown> { return Object.values(await (this.row as any)(a, ...rest) ?? {})[0]; }

  indexCol(strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>>;
  indexCol(frag: Sql): Promise<Record<string, unknown>>;
  async indexCol(a: any, ...rest: any[]): Promise<Record<string, unknown>> {
    return Object.fromEntries((await (this.query as any)(a, ...rest)).map((r: RowDataPacket) => Object.values(r) as [string, unknown]));
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

  table(name: string): DbTable {
    const table = this.#tables[name];
    if (!table) throw new Error(`unknown table: ${name}`);
    return table;
  }
  escapeId(id: string): string { return this.#driver.escapeId(id); }

  close = (): Promise<void> => this.#driver.close();

  on(name: string, fn: (data: Record<string, any>) => void | Promise<void>): void {
    (this.#events[name] ??= []).push(fn);
  }
  async fire(name: string, data: Record<string, any> = {}): Promise<void> {
    if (!this.#events[name]) return;
    data["eventType"] = name;
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
