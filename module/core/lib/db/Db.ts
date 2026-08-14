// deno-lint-ignore-file no-explicit-any
import { AsyncLocalStorage } from "node:async_hooks";

import { DbTable } from "./DbTable.ts";
import { sql, isTemplate, render, resolveSql, mysqlDialect, sqliteDialect, pgDialect } from "../../deps.ts";
import { DbDriver } from "./DbDriver.ts";
import { Emitter } from "../Emitter.ts";

import type { Sql } from "../../deps.ts";
import type { DbDialect, ExecResult, MigrateOptions, Row } from "./DbDriver.ts";
import type { DbRow } from "./DbRow.ts";

export const DATE_TYPES = new Set(["datetime", "date", "timestamp"]);
export const STRING_TYPES = new Set(["char", "varchar", "binary", "varbinary", "blob", "text", "enum", "set"]);
// INTEGER is SQLite's spelling of INT — without it the same schema coerces on MySQL and lets
// non-numeric text through on SQLite, where column affinity then stores it verbatim. Same for
// REAL (SQLite) and NUMERIC (Postgres) beside MySQL's DOUBLE.
export const NUM_TYPES = new Set(["tinyint", "smallint", "mediumint", "int", "integer", "bigint", "decimal", "float", "double", "real", "numeric"]);

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
    
    // Any write through a table reaches the row object holding that row, whoever wrote it.
    this.on("table:insert-after", ({ table, id }) => table.invalidate(id)); // a handle may hold "does not exist"
    this.on("table:update-after", ({ table, id }) => table.invalidate(id));
    this.on("table:delete-after", ({ table, id }) => table.invalidate(id, true));
  }

  // new:
  /* --- pending row writes ------------------------------------------------------------------ */

  #dirty = new Set<DbRow>();
  #flushing: Promise<void> | null = null;

  /** Queue a changed row. The set holds it strongly, so nothing unwritten can be collected. */
  markDirty(row: DbRow): void {
    this.#dirty.add(row);
    this.#flushing ??= Promise.resolve().then(() => this.flush().catch(() => {})); // errors are reported in flush()
  }

  /** Write every pending row in one transaction. Rows that fail stay dirty and keep their values. */
  async flush(): Promise<void> {
    this.#flushing = null;
    if (!this.#dirty.size) return;
    const rows = [...this.#dirty];
    this.#dirty.clear();
    try {
      await this.transaction(async () => { for (const row of rows) await row.$save(); });
    } catch (e) {
      // Never silent: an unwritten change is data loss, and the caller of an explicit save() rethrows.
      console.error("db: flushing rows failed:", e);
      for (const row of rows) if (row.$changed) this.#dirty.add(row);
      throw e;
    }
  }






  get dialect(): DbDialect { return this.#driver.dialect; }
  get emptyInsert(): string { return this.#dialect.emptyInsert; }
  get insertSyncsAutoIncrement(): boolean { return this.#driver.insertSyncsAutoIncrement; }
  get tables(): Record<string, DbTable> { return this.#tables; }

  async #run<T>(fn: () => Promise<T>, sql: string): Promise<T> {
    try { //console.log(sql);
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

  /** Move the id generator past `value`, so it never hands that id out again. */
  syncAutoIncrement(table: string, field: string, value: number): Promise<void> {
    if (!Number.isInteger(value) || value < 1) return Promise.resolve();
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
    const tables: Record<string, DbTable> = {};
    for (const name of await this.#driver.listTables()) {
      // Keep the object a table already has: installing a module re-runs this, and a fresh
      // DbTable would drop its row class and identity map.
      tables[name] = this.#tables[name] ?? new DbTable(this, name);
      await tables[name].reloadFields();
    }
    this.#tables = tables; // swapped in one go — introspection takes a while, and a timer or a
                           // parallel request must never meet a half-filled database
  }

  table(name: string): DbTable {
    const table = this.#tables[name];
    if (!table) throw new Error(`unknown table: ${name}`);
    return table;
  }

  close(): Promise<void> { return this.#driver.close(); }
}
