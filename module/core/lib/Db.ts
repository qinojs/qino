// deno-lint-ignore-file no-explicit-any
import { mysql, type Pool, type ResultSetHeader, type RowDataPacket } from "../../../deps.ts";
import { DbTable } from "./DbTable.ts";

export const dateTypes: Record<string, 1> = { DATETIME: 1, DATE: 1, TIMESTAMP: 1 };
export const stringTypes: Record<string, 1> = { CHAR: 1, VARCHAR: 1, BINARY: 1, VARBINARY: 1, BLOB: 1, TEXT: 1, ENUM: 1, SET: 1 };
export const numTypes: Record<string, 1> = { TINYINT: 1, SMALLINT: 1, MEDIUMINT: 1, INT: 1, BIGINT: 1, DECIMAL: 1, FLOAT: 1, DOUBLE: 1 };
export const sqlMode = [
  "ONLY_FULL_GROUP_BY",
  // "STRICT_ALL_TABLES",     // future: requires explicit defaults for all required fields
  "NO_ZERO_IN_DATE",
  "NO_ZERO_DATE",
  "ERROR_FOR_DIVISION_BY_ZERO",
  "NO_ENGINE_SUBSTITUTION",
  // "ANSI_QUOTES",          // future: use "..." for identifiers only, closer to SQL standard
  // "NO_BACKSLASH_ESCAPES", // future: standard string escaping; requires replacing Db.quote()
].join(",");

export class Db {
  static escapeId = mysql.escapeId;

  #tables: Record<string, DbTable> = {};
  #pool: Pool;
  #database: string;
  #connParams: { host: string; user: string; password: string };
  #schema: Record<string, any> = { properties: {} };
  #events: Record<string, ((data: Record<string, any>) => void | Promise<void>)[]> = {};

  constructor(conn: string, user: string, pass: string) {
    const [, host = "localhost"] = conn.match(/host=([^;]+)/) ?? [];
    const [, database = user] = conn.match(/dbname=([^;]+)/) ?? [];
    this.#database = database;
    this.#connParams = { host, user, password: pass };

    this.#pool = mysql.createPool({
      host,
      user,
      password: pass,
      database,
      charset: "utf8mb4",
      multipleStatements: false,
      waitForConnections: true,
      connectionLimit: 10,
      timezone: "Z",
    });
    this.#pool.on("connection", (c: { query(sql: string, params?: unknown[]): void }) => c.query("SET SESSION sql_mode = ?", [sqlMode]));
  }

  get tables(): Record<string, DbTable> { return this.#tables; }
  get schema(): Record<string, any> { return this.#schema; }
  set schema(schema: Record<string, any>) { this.#schema = schema; }

  async #exec<T extends RowDataPacket[] | ResultSetHeader>(sql: string, params?: unknown[], isQuery = false): Promise<T> {
    try {
      const [res] = isQuery ? await this.#pool.query<T>(sql, params) : await this.#pool.execute<T>(sql, params as any);
      return res;
    } catch (e) {
      console.error("mysql: " + (e instanceof Error ? e.message : e) + "\n" + sql.replace(/\s+/g, " "), e);
      throw e;
    }
  }

  query(sql: string, params?: unknown[]): Promise<RowDataPacket[]> {
    return this.#exec<RowDataPacket[]>(sql, params, true);
  }

  exec(sql: string, params?: unknown[]): Promise<ResultSetHeader> {
    return this.#exec<ResultSetHeader>(sql, params, false);
  }

  all = (sql: string, p?: unknown[]): Promise<RowDataPacket[]> => this.query(sql, p);
  row = async (sql: string, p?: unknown[]): Promise<RowDataPacket | undefined> => (await this.query(sql, p))[0];
  col = async (sql: string, p?: unknown[]): Promise<unknown[]> => (await this.query(sql, p)).map((r) => Object.values(r)[0]);
  one = async (sql: string, p?: unknown[]): Promise<unknown> => Object.values(await this.row(sql, p) ?? {})[0];

  async indexCol(sql: string, p?: unknown[]): Promise<Record<string, unknown>> {
    return Object.fromEntries((await this.query(sql, p)).map((r) => Object.values(r) as [string, unknown]));
  }

  async init(): Promise<void> {
    const tmp = mysql.createPool({ ...this.#connParams, charset: "utf8mb4" });
    try {
      await tmp.query(`CREATE DATABASE IF NOT EXISTS ${Db.escapeId(this.#database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`);
    } finally {
      await tmp.end();
    }
    const tables = await this.col("SHOW TABLES") as string[];
    this.#tables = {};
    for (const table of tables) {
      this.#tables[table] = new DbTable(this, table);
      await this.#tables[table].init();
    }
  }

  table(name: string): DbTable { return this.#tables[name]; }

  close = (): Promise<void> => this.#pool.end();

  on(name: string, fn: (data: Record<string, any>) => void | Promise<void>): void {
    (this.#events[name] ??= []).push(fn);
  }
  async fire(name: string, data: Record<string, any> = {}): Promise<void> {
    if (!this.#events[name]) return;
    data["event_type"] = name;
    for (const fn of this.#events[name]) await fn(data);
  }

  /** @deprecated unsafe, use prepared statement parameters instead */
  static quote(v: unknown): string {
    if (v == null) return "NULL";
    return `'${String(v).replace(/[\0\b\t\n\r'"\\]/g, c => ({
      "\0": "\\0", "\b": "\\b", "\t": "\\t", "\n": "\\n",
      "\r": "\\r", "'": "\\'", '"': '\\"', "\\": "\\\\",
    }[c]!))}'`;
  }

}
