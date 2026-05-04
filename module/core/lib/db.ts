// deno-lint-ignore-file no-explicit-any
import { mysql, type Pool, type ResultSetHeader, type RowDataPacket } from "../../../deps.ts";
import { dbTable } from "./dbTable.ts";

const DB_DATE_TYPES: Record<string, 1> = { DATETIME: 1, DATE: 1, TIMESTAMP: 1 };
const DB_NUM_TYPES: Record<string, 1> = { TINYINT: 1, SMALLINT: 1, MEDIUMINT: 1, INT: 1, BIGINT: 1, DECIMAL: 1, FLOAT: 1, DOUBLE: 1 };

export class DB {
  #tables: Record<string, dbTable> = {};
  #pool: Pool;
  #database: string;
  #connParams: { host: string; user: string; password: string };
  #fieldMeta: Record<string, Record<string, Record<string, any>>> = {};

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
    this.#pool.on("connection", (c: any) => {
      c.query("SET SESSION sql_mode = ''");
      //c.query(`SET SESSION sql_mode = 'STRICT_TRANS_TABLES,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY'`);
    });
  }

  // Zentrale Methode, query und exec nutzen die gleiche
  async #exec<T extends RowDataPacket[] | ResultSetHeader>(sql: string, params?: unknown[], isQuery = false): Promise<T> {
    try {
      const [res] = isQuery ? await this.#pool.query<T>(sql, params) : await this.#pool.execute<T>(sql, params as any);
      return res;
    } catch (e: any) {
      console.error("mysql: " + e.message + "\n" + sql.replace(/\s+/g, " "), e);
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

  async indexCol(sql: string, p?: unknown[]): Promise<Record<string, any>> {
    return Object.fromEntries((await this.query(sql, p)).map((r) => Object.values(r) as [string, any]));
  }

  static escapeId = mysql.escapeId;

  async init(): Promise<void> {
    const tmp = mysql.createPool({ ...this.#connParams, charset: "utf8mb4" });
    try {
      await tmp.query(`CREATE DATABASE IF NOT EXISTS \`${this.#database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`);
    } finally {
      await tmp.end();
    }
    const tables = await this.col("SHOW TABLES") as string[];
    this.#tables = {};
    for (const table of tables) {
      this.#tables[table] = new dbTable(this, table);
      await this.#tables[table].init();
    }
  }

  get tables(): Record<string, dbTable> { return this.#tables; }

  table(name: string): dbTable { return this.#tables[name]; }

  registerSchema(schema: Record<string, any>): void {
    for (const [tableName, tableSchema] of Object.entries(schema.properties ?? {})) {
      const fields = (tableSchema as any).additionalProperties?.properties ?? {};
      this.#fieldMeta[tableName] ??= {};
      for (const [fieldName, fieldSchema] of Object.entries(fields)) {
        const s = fieldSchema as Record<string, any>;
        this.#fieldMeta[tableName][fieldName] = {
          title: s.title ?? "",
          description: s.description ?? "",
          parent: s["x-qg-parent"] ?? "",
          parent_field: s["x-qg-parent-field"] ?? "",
          on_parent_delete: s["x-qg-on-parent-delete"] ?? "",
          on_parent_copy: s["x-qg-on-parent-copy"] ?? "",
        };
      }
    }
  }

  fieldMeta(table: string, field: string): Record<string, any> {
    return this.#fieldMeta[table]?.[field] ?? {};
  }

  childFields(parentTable: string): Array<{ table: string; field: string }> {
    const children: Array<{ table: string; field: string }> = [];
    for (const [table, fields] of Object.entries(this.#fieldMeta)) {
      for (const [field, meta] of Object.entries(fields)) {
        if (meta.parent === parentTable) children.push({ table, field });
      }
    }
    return children;
  }

  async addTable(name: string): Promise<dbTable> {
    const id = DB.escapeId(name);
    await this.exec(`CREATE TABLE IF NOT EXISTS ${id} (id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci`);
    await this.init();
    return this.table(name);
  }

  async removeTable(name: string): Promise<void> {
    const id = DB.escapeId(name);
    await this.exec(`DROP TABLE IF EXISTS ${id}`);
    delete this.#fieldMeta[name];
    await this.init();
  }

  close = (): Promise<void> => this.#pool.end();

  #events: Record<string, ((data: Record<string, any>) => void | Promise<void>)[]> = {};
  on(name: string, fn: (data: Record<string, any>) => void | Promise<void>): void {
    if (!this.#events[name]) this.#events[name] = [];
    this.#events[name].push(fn);
  }
  async fire(name: string, data: Record<string, any> = {}): Promise<void> {
    if (!this.#events[name]) return;
    data["event_type"] = name;
    for (const fn of this.#events[name]) await fn(data);
  }

  static quote(v: any): string {
    return v == null ? "NULL" : `'${String(v).replace(/[\\'\n\r\0]/g, c => ({ "\\": "\\\\", "'": "\\'", "\n": "\\n", "\r": "\\r", "\0": "\\0" }[c]!))}'`;
  }

  static _array_to_column_definition(d: Record<string, any>): string {
    d = { type: "varchar", length: false, special: "", collate: false, null: false, autoincrement: false, default: false, ...d };
    d.type = String(d.type).trim().toUpperCase();
    d.special = String(d.special).trim().toUpperCase();

    if (!["VARCHAR","TINYINT","TEXT","DATE","SMALLINT","MEDIUMINT","INT","BIGINT","FLOAT","DOUBLE","DECIMAL","DATETIME","TIMESTAMP","TIME","YEAR","CHAR","TINYBLOB","TINYTEXT","BLOB","MEDIUMBLOB","MEDIUMTEXT","LONGBLOB","LONGTEXT","BOOL","BINARY"].includes(d.type)) {
      throw new Error(`field type "${d.type}" not allowed`);
    }
    if (!["","BINARY","UNSIGNED","UNSIGNED ZEROFILL","ON UPDATE CURRENT_TIMESTAMP"].includes(d.special)) {
      throw new Error(`field special "${d.special}" not allowed`);
    }

    let len = d.length ? `(${d.length})` : "";
    if (["DATE","DATETIME","FLOAT","TEXT","TINYTEXT","MEDIUMTEXT","LONGTEXT"].includes(d.type)) len = "";
    if (d.type === "VARCHAR" && !len) len = "(191)";
    if (d.type === "DECIMAL" && d.length > 65) len = "(12,8)";

    let def = "";
    if (d.autoincrement) def = "AUTO_INCREMENT";
    else if (d.default !== false) {
      const defVal = String(d.default).toUpperCase();
      def = "DEFAULT " + ({ NULL: 1, CURRENT_TIMESTAMP: 1, "CURRENT_TIMESTAMP()": 1, "NOW()": 1, LOCALTIME: 1, "LOCALTIME()": 1, LOCALTIMESTAMP: 1, "LOCALTIMESTAMP()": 1 }[defVal] ? defVal : "?");
    }

    if (DB_NUM_TYPES[d.type] || DB_DATE_TYPES[d.type]) d.collate = false;
    const col = d.collate ? `CHARACTER SET ${String(d.collate).split("_")[0]} COLLATE ${d.collate} ` : "";

    return ` ${d.type}${len} ${d.special} ${col}${d.null ? "NULL" : "NOT NULL"} ${def}`;
  }

  /** @deprecated Nutze stattdessen `(await db.exec(...)).insertId`. */
  lastInsertId = async (): Promise<number> => Number(await this.one("SELECT LAST_INSERT_ID()") ?? 0);
}
