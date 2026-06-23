// deno-lint-ignore-file no-explicit-any
import { mysql, type RowDataPacket } from "../../../deps.ts";
import { type DbDialect, type Driver, type ExecResult, type MigrateOptions, makeDriver } from "./dbDriver.ts";
import { DbTable } from "./DbTable.ts";
import { Sql, sql, isTemplate } from "./sql.ts";

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

  /** Render a fragment / tag / legacy string to this dialect's [sql, params]. */
  #sql(a: TemplateStringsArray | Sql | string, rest: unknown[]): [string, unknown[]] {
    if (isTemplate(a)) a = sql(a, ...rest);
    if (a instanceof Sql) {
      let text = "";
      const params: unknown[] = [];
      for (const p of a.parts) {
        if ("text" in p) text += p.text;
        else if ("id" in p) text += this.#driver.escapeId(p.id);
        else { params.push(p.param); text += this.#driver.placeholder(params.length); }
      }
      return [text, params];
    }
    return [this.#driver.translateLegacy(a), (rest[0] as unknown[]) ?? []]; // deprecated string path
  }

  query(strings: TemplateStringsArray, ...values: unknown[]): Promise<RowDataPacket[]>;
  query(frag: Sql): Promise<RowDataPacket[]>;
  /** @deprecated Use the sql`` tag: db.query`…`. */
  query(sql: string, params?: unknown[]): Promise<RowDataPacket[]>;
  query(a: TemplateStringsArray | Sql | string, ...rest: unknown[]): Promise<RowDataPacket[]> {
    const [text, params] = this.#sql(a, rest);
    return this.#run(() => this.#driver.query(text, params), text) as Promise<RowDataPacket[]>;
  }

  exec(strings: TemplateStringsArray, ...values: unknown[]): Promise<ExecResult>;
  exec(frag: Sql, returning?: string): Promise<ExecResult>;
  /** @deprecated Use the sql`` tag: db.exec`…`. */
  exec(sql: string, params?: unknown[], returning?: string): Promise<ExecResult>;
  exec(a: TemplateStringsArray | Sql | string, ...rest: unknown[]): Promise<ExecResult> {
    const returning = isTemplate(a) ? undefined : a instanceof Sql ? rest[0] as string : rest[1] as string;
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
  /** @deprecated Use the sql`` tag. */
  all(sql: string, params?: unknown[]): Promise<RowDataPacket[]>;
  all(a: any, ...rest: any[]): Promise<RowDataPacket[]> { return this.query(a, ...rest); }

  row(strings: TemplateStringsArray, ...values: unknown[]): Promise<RowDataPacket | undefined>;
  row(frag: Sql): Promise<RowDataPacket | undefined>;
  /** @deprecated Use the sql`` tag. */
  row(sql: string, params?: unknown[]): Promise<RowDataPacket | undefined>;
  async row(a: any, ...rest: any[]): Promise<RowDataPacket | undefined> { return (await this.query(a, ...rest))[0]; }

  col(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  col(frag: Sql): Promise<unknown[]>;
  /** @deprecated Use the sql`` tag. */
  col(sql: string, params?: unknown[]): Promise<unknown[]>;
  async col(a: any, ...rest: any[]): Promise<unknown[]> { return (await this.query(a, ...rest)).map((r) => Object.values(r)[0]); }

  one(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  one(frag: Sql): Promise<unknown>;
  /** @deprecated Use the sql`` tag. */
  one(sql: string, params?: unknown[]): Promise<unknown>;
  async one(a: any, ...rest: any[]): Promise<unknown> { return Object.values(await this.row(a, ...rest) ?? {})[0]; }

  indexCol(strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>>;
  indexCol(frag: Sql): Promise<Record<string, unknown>>;
  /** @deprecated Use the sql`` tag. */
  indexCol(sql: string, params?: unknown[]): Promise<Record<string, unknown>>;
  async indexCol(a: any, ...rest: any[]): Promise<Record<string, unknown>> {
    return Object.fromEntries((await this.query(a, ...rest)).map((r) => Object.values(r) as [string, unknown]));
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
