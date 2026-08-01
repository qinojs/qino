// deno-lint-ignore-file no-explicit-any
import { DbTable } from "./DbTable.ts";
import { sql, isTemplate, render, resolveSql, mysqlDialect, sqliteDialect, pgDialect, type Sql } from "../../deps.ts";
import { type DbDialect, type ExecResult, type MigrateOptions, type Row, DbDriver } from "./DbDriver.ts";
import { Emitter } from "../Emitter.ts";
import { AsyncLocalStorage } from "node:async_hooks";

export const dateTypes = new Set(["DATETIME", "DATE", "TIMESTAMP"]);
export const stringTypes = new Set(["CHAR", "VARCHAR", "BINARY", "VARBINARY", "BLOB", "TEXT", "ENUM", "SET"]);
// INTEGER is SQLite's spelling of INT — without it the same schema coerces on MySQL and lets
// non-numeric text through on SQLite, where column affinity then stores it verbatim.
export const numTypes = new Set(["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT", "DECIMAL", "FLOAT", "DOUBLE"]);

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
  #tx = new AsyncLocalStorage<{ hooks: (() => unknown)[] | null }>();
  schema: Record<string, any> = { properties: {} };

  constructor(conn: string) {
    super();
    this.#driver = DbDriver.from(conn);
    // Dialect (quoting + placeholders) for rendering comes from item.js — one source for all backends.
    this.#dialect = { mysql: mysqlDialect, sqlite: sqliteDialect, postgres: pgDialect }[this.#driver.dialect];
  }

  get dialect(): DbDialect { return this.#driver.dialect; }
  get emptyInsert(): string { return this.#dialect.emptyInsert; }
  get tables(): Record<string, DbTable> { return this.#tables; }

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

  /** Fragments run via interpolation: `db.query\`${frag}\`` — same for the shortcuts below. */
  async query<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    const [text, params] = await this.#sql(strings, values);
    return this.#run(() => this.#driver.query(text, params), text) as Promise<T[]>;
  }

  async row<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | undefined> {
    return (await this.query<T>(strings, ...values))[0];
  }

  async col<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    return (await this.query(strings, ...values)).map((r) => Object.values(r)[0]);
  }

  async one<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | undefined> {
    return Object.values((await this.query(strings, ...values))[0] ?? {})[0];
  }

  async indexCol<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, T>> {
    return Object.fromEntries((await this.query(strings, ...values)).map((r) => Object.values(r) as [string, T]));
  }

  exec(strings: TemplateStringsArray, ...values: unknown[]): Promise<ExecResult>;
  exec(frag: Sql, returning?: string): Promise<ExecResult>;
  async exec(a: TemplateStringsArray | Sql, ...rest: unknown[]): Promise<ExecResult> {
    const returning = isTemplate(a) ? undefined : rest[0] as string;
    const [text, params] = await this.#sql(a, rest);
    return this.#run(() => this.#driver.exec(text, params, returning), text);
  }

  /** Run fn atomically; nested calls join the outer transaction. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#tx.getStore()?.hooks) return this.#driver.transaction(fn); // nested → join
    const tx: { hooks: (() => unknown)[] | null } = { hooks: [] };
    try {
      const r = await this.#tx.run(tx, () => this.#driver.transaction(fn));
      for (const hook of tx.hooks!) await hook();
      return r;
    } finally {
      tx.hooks = null; // a late call must not queue onto a finished transaction
    }
  }

  /** Defer a non-rollbackable side effect (file unlink) until the outermost transaction committed. */
  async afterCommit(fn: () => unknown): Promise<void> {
    const hooks = this.#tx.getStore()?.hooks;
    if (hooks) hooks.push(fn);
    else await fn();
  }

  syncAutoIncrement(table: string, field: string, value: number): Promise<void> {
    return this.#driver.syncAutoIncrement(table, field, value);
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
