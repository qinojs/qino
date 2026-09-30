import type { Db } from "./Db.ts";
import type { DbTable } from "./DbTable.ts";

export const DATE_TYPES = new Set(["datetime", "date", "timestamp"]);
export const STRING_TYPES = new Set(["char", "varchar", "binary", "varbinary", "blob", "text", "enum", "set"]);
// INTEGER is SQLite's INT — otherwise SQLite would store non-numeric text as is. Same for REAL
// (SQLite) and NUMERIC (Postgres) next to MySQL's DOUBLE.
export const NUM_TYPES = new Set(["tinyint", "smallint", "mediumint", "int", "integer", "bigint", "decimal", "float", "double", "real", "numeric"]);

export class DbField {

  #type: string;
  #length: string;
  #special: string;
  #name: string;

  vs: Record<string, any>;
  table: DbTable;
  db: Db;

  constructor(table: DbTable, name: string, vs: Record<string, any>) {
    this.table = table;
    this.db = table.db;
    this.#name = name;
    this.vs = vs;
    const match = vs.Type?.match(/^([a-z]+)(\(([^)]+)\)|.*)(.*)$/i);
    this.#type = match?.[1].toLowerCase().trim() ?? "varchar";
    this.#length = match?.[3]?.trim() ?? "";
    this.#special = match?.[4]?.trim().toLowerCase() ?? "";
  }

  get name(): string { return this.#name; }
  get type(): string { return this.#type; }
  get length(): string { return this.#length; }
  get special(): string { return this.#special; }
  get null(): boolean { return this.vs.Null === "YES"; }
  get default(): unknown { return this.vs.Default; }
  get collate(): string { return this.vs.Collation ?? ""; }
  get schema(): Record<string, any> { return this.table.schema?.additionalProperties?.properties?.[this.#name] ?? {}; }
  get onParentCopy(): string { return this.schema["x-qg-on-parent-copy"] ?? ""; }
  get onParentDelete(): string { return this.schema["x-qg-on-parent-delete"] ?? ""; }
  get key(): string { return this.vs.Key ?? ""; }
  get id(): number { return this.vs.id; }
  isPrimary(): boolean { return this.vs.Key === "PRI"; }
  isAutoIncrement(): boolean { return this.vs.Extra === "auto_increment"; }

  valueTransform(value: any): any {
    if (this.null && (value === null || value === "" && !STRING_TYPES.has(this.#type))) return null;
    // The schema type wins over the column type: SQLite stores booleans as INTEGER, so `true` would
    // otherwise be stored as the text "true", which is always truthy.
    if (this.#type === "boolean" || this.schema.type === "boolean") return value === true || value === 1 || value === "1" || value === "true";
    if (typeof value === "number" && DATE_TYPES.has(this.#type))
      return new Date(value * 1000).toISOString().replace("T", " ").slice(0,19);
    if (NUM_TYPES.has(this.#type)) {
      // Number() is strict ("12abc" fails); "" and null become 0 on NOT NULL columns.
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) throw new Error(`invalid numeric value for ${this.table}.${this.#name}: ${JSON.stringify(value)}`);
      value = num;
    }
    return String(value ?? "");
  }

  parent(): DbTable | undefined {
    return this.schema["x-qg-parent"] ? this.db.table(this.schema["x-qg-parent"]) : undefined;
  }
  parentField(): DbField | undefined {
    const parent = this.parent();
    if (!parent) return;
    return this.schema["x-qg-parent-field"] ? parent.field(this.schema["x-qg-parent-field"]) : parent.primary;
  }

  toString(): string { return this.#name; }

}
