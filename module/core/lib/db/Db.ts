// deno-lint-ignore-file no-explicit-any
import { DbTable } from "./DbTable.ts";
import { sql, isTemplate, render, resolveSql, mysqlDialect, sqliteDialect, pgDialect, type Sql } from "../../../../deps.ts";
import { type DbDialect, type ExecResult, type MigrateOptions, type Row, DbDriver } from "./DbDriver.ts";
import { Emitter } from "../Emitter.ts";

export const dateTypes = new Set(["DATETIME", "DATE", "TIMESTAMP"]);
export const stringTypes = new Set(["CHAR", "VARCHAR", "BINARY", "VARBINARY", "BLOB", "TEXT", "ENUM", "SET"]);
export const numTypes = new Set(["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT", "DECIMAL", "FLOAT", "DOUBLE"]);

/** Core db events. Module events are allowed but untyped — JSR forbids augmenting this map from a module. */
export interface DbEvents {
  "table:insert-before": { table: DbTable; data: Record<string, any>; returnValue?: unknown };
  "table:insert-after": { table: DbTable; id: any; data: Record<string, any> };
  "table:update-before": { table: DbTable; id: any; data: Record<string, any>; returnValue?: unknown };
  "table:update-after": { table: DbTable; id: any; data: Record<string, any> };
  "table:delete-before": { table: DbTable; id: any; data: Record<string, any>; returnValue?: unknown };
  "table:delete-after": { table: DbTable; id: any; data: Record<string, any> };
  [name: string]: Record<string, unknown>; // untyped module events stay allowed
}

export class Db extends Emitter<DbEvents> {
  #tables: Record<string, DbTable> = {};
  #driver: DbDriver;
  #dialect: { quoteId(id: string): string; placeholder(n: number): string; emptyInsert: string };
  #schema: Record<string, any> = { properties: {} };

  constructor(conn: string) {
    super();
    this.#driver = DbDriver.from(conn);
    // Dialect (quoting + placeholders) for rendering comes from item.js — one source for all backends.
    this.#dialect = { mysql: mysqlDialect, sqlite: sqliteDialect, postgres: pgDialect }[this.#driver.dialect];
  }

  get dialect(): DbDialect { return this.#driver.dialect; }
  get emptyInsert(): string { return this.#dialect.emptyInsert; }
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

  /** Render a fragment / tag to this dialect's [sql, params]; awaits promised values. */
  async #sql(a: TemplateStringsArray | Sql, rest: unknown[]): Promise<[string, unknown[]]> {
    const frag = isTemplate(a) ? sql(a, ...rest) : a;
    await resolveSql(frag);
    const { text, params } = render(frag, this.#dialect);
    return [text, params];
  }

  /** Shared base of query and its shortcuts. Fragments run via `db.query\`${frag}\``. */
  async #q(strings: TemplateStringsArray, values: unknown[]): Promise<any[]> {
    const [text, params] = await this.#sql(strings, values);
    return this.#run(() => this.#driver.query(text, params), text);
  }

  query<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> { return this.#q(strings, values); }

  exec(strings: TemplateStringsArray, ...values: unknown[]): Promise<ExecResult>;
  exec(frag: Sql, returning?: string): Promise<ExecResult>;
  async exec(a: TemplateStringsArray | Sql, ...rest: unknown[]): Promise<ExecResult> {
    const returning = isTemplate(a) ? undefined : rest[0] as string;
    const [text, params] = await this.#sql(a, rest);
    return this.#run(() => this.#driver.exec(text, params, returning), text);
  }
  /** Run fn atomically; nested calls join the outer transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.#driver.transaction(fn);
  }
  syncAutoIncrement(table: string, field: string, value: number): Promise<void> {
    return this.#driver.syncAutoIncrement(table, field, value);
  }

  async row<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | undefined> { return (await this.#q(strings, values))[0]; }

  async col<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> { return (await this.#q(strings, values)).map((r) => Object.values(r)[0] as T); }

  async one<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | undefined> { return Object.values((await this.#q(strings, values))[0] ?? {})[0] as T | undefined; }

  async indexCol<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, T>> {
    return Object.fromEntries((await this.#q(strings, values)).map((r) => Object.values(r) as [string, T]));
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

  close(): Promise<void> { return this.#driver.close(); }
}
