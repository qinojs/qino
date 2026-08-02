import { dateTypes, stringTypes, numTypes, type Db } from "./Db.ts";
import type { DbTable } from "./DbTable.ts";

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
    if (this.null && value === null) return null;
    if (this.null && value === "" && !stringTypes.has(this.#type)) return null;
    // What the schema declares beats what the dialect calls the column: SQLite has no boolean type
    // and stores one as INTEGER, so relying on the column type alone would let `true` fall through
    // to String() and land as the text "true" — which every later read then sees as truthy.
    if (this.#type === "boolean" || this.schema.type === "boolean") return value === true || value === 1 || value === "1" || value === "true";
    if (typeof value === "number" && dateTypes.has(this.#type)) {
      return new Date(value * 1000).toISOString().replace("T", " ").slice(0,19);
    }
    if (numTypes.has(this.#type)) {
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
