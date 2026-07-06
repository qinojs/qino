// deno-lint-ignore-file no-explicit-any
import { DbTable } from "./DbTable.ts";
import { sql, isTemplate, render, resolveSql, mysqlDialect, sqliteDialect, pgDialect, type Sql } from "../../../../deps.ts";
import { type DbDialect, type ExecResult, type MigrateOptions, type Row, DbDriver } from "./DbDriver.ts";
import { Emitter } from "../Emitter.ts";

export const dateTypes = new Set(["DATETIME", "DATE", "TIMESTAMP"]);
export const stringTypes = new Set(["CHAR", "VARCHAR", "BINARY", "VARBINARY", "BLOB", "TEXT", "ENUM", "SET"]);
export const numTypes = new Set(["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT", "DECIMAL", "FLOAT", "DOUBLE"]);

/** Core db events; modules add their own via `declare module "../core/lib/db/Db.ts" { interface DbEvents {...} }`. */
export interface DbEvents {
  "table::insert-before": { Table: DbTable; data: Record<string, any>; returnValue?: unknown };
  "table::insert-after": { Table: DbTable; id: any; data: Record<string, any> };
  "table::update-before": { Table: DbTable; id: any; data: Record<string, any>; returnValue?: unknown };
  "table::update-after": { Table: DbTable; id: any; data: Record<string, any> };
  "table::delete-before": { Table: DbTable; id: any; data: Record<string, any>; returnValue?: unknown };
  "table::delete-after": { Table: DbTable; id: any; data: Record<string, any> };
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

  query<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Row>(frag: Sql): Promise<T[]>;
  async query(a: TemplateStringsArray | Sql, ...rest: unknown[]): Promise<any[]> {
    const [text, params] = await this.#sql(a, rest);
    return this.#run(() => this.#driver.query(text, params), text);
  }

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

  row<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | undefined>;
  row<T = Row>(frag: Sql): Promise<T | undefined>;
  async row(a: any, ...rest: any[]): Promise<any> { return (await (this.query as any)(a, ...rest))[0]; }

  col<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  col<T = unknown>(frag: Sql): Promise<T[]>;
  async col(a: any, ...rest: any[]): Promise<any[]> { return (await (this.query as any)(a, ...rest)).map((r: Row) => Object.values(r)[0]); }

  one<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  one<T = unknown>(frag: Sql): Promise<T>;
  async one(a: any, ...rest: any[]): Promise<any> { return Object.values(await (this.row as any)(a, ...rest) ?? {})[0]; }

  indexCol<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, T>>;
  indexCol<T = unknown>(frag: Sql): Promise<Record<string, T>>;
  async indexCol(a: any, ...rest: any[]): Promise<Record<string, any>> {
    return Object.fromEntries((await (this.query as any)(a, ...rest)).map((r: Row) => Object.values(r) as [string, unknown]));
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
