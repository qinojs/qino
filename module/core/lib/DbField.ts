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
  get schema(): Record<string, any> { return this.table.schema.additionalProperties?.properties?.[this.#name] ?? {}; }
  get onParentCopy(): string { return this.schema["x-qg-on-parent-copy"] ?? ""; }
  get onParentDelete(): string { return this.schema["x-qg-on-parent-delete"] ?? ""; }
  get key(): string { return this.vs.Key ?? ""; }
  get id(): number { return this.vs.id; }
  isPrimary(): boolean { return this.vs.Key === "PRI"; }
  isAutoIncrement(): boolean { return this.vs.Extra === "auto_increment"; }

  valueTransform(value: any): any {
    const type = this.type.toUpperCase();
    if (this.null && value === null) return null;
    if (this.null && value === "" && !stringTypes[type]) return null;
    if (type === "BOOLEAN") return value === true || value === 1 || value === "1" || value === "true";
    if (typeof value === "number" && dateTypes[type]) {
      return new Date(value * 1000).toISOString().replace("T", " ").slice(0,19);
    }
    if (numTypes[type] && typeof value !== "number") {
      value = parseFloat(String(value)) || 0;
    }
    return String(value ?? "");
  }

  parent(): DbTable | false {
    return this.schema["x-qg-parent"] ? this.db.table(this.schema["x-qg-parent"]) : false;
  }
  parentField(): DbField | false {
    const parent = this.parent();
    if (!parent) return false;
    return this.schema["x-qg-parent-field"] ? parent.field(this.schema["x-qg-parent-field"]) : parent.primary;
  }

  toString(): string { return this.#name; }

}
