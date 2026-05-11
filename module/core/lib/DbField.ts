/**
 * dbField.ts - Database field abstraction
 * Port of core/lib/dbField.class.php
 */

import type { DbTable } from "./DbTable.ts";
import { Db, dateTypes, stringTypes, numTypes } from "./Db.ts";

export class DbField {

  #type: string | null = null;
  #length: string | null = null;
  #special: string | null = null;
  #name: string;

  vs: Record<string, any>;
  table: DbTable;
  db: Db;

  constructor(Table: DbTable, name: string, vs: Record<string, any>) {
    this.table = Table;
    this.db = Table.db;
    this.#name = name;
    this.vs = vs;
  }

  toString(): string { return this.#name; }
  get name(): string { return this.#name; }

  valueTransform(value: any): any {
    const type = this.type.toUpperCase();
    if (this.null && value === null) return null;
    if (this.null && value === "" && !stringTypes[type]) return null;
    if (typeof value === "number" && dateTypes[type]) {
      return new Date(value * 1000).toISOString().replace("T", " ").slice(0,19);
    }
    if (numTypes[type] && typeof value !== "number") {
      value = parseFloat(String(value)) || 0;
    }
    return String(value ?? "");
  }

  valueToSql(value: any): string {
    value = this.valueTransform(value);
    return value === null ? "NULL" : Db.quote(value); // Db.quote hier behalten!
  }

  isPrimary(): boolean { return this.vs.Key === "PRI"; }
  get key(): string { return this.vs.Key ?? ""; }
  isAutoIncrement(): boolean { return this.vs.Extra === "auto_increment"; }

  #explodeTypeData(): void {
    if (this.#type === null) {
      const match = this.vs.Type?.match(/^([a-z]+)(\(([^)]+)\)|.*)(.*)$/i);
      this.#type = match ? match[1].toLowerCase().trim() : "varchar";
      this.#length = match ? (match[3] ?? "").trim() : "";
      this.#special = match ? (match[4] ?? "").trim().toLowerCase() : "";
    }
  }
  async #change(data: Record<string, any>): Promise<void> {
    data.type = data.type ?? this.type;
    data.length = data.length ?? this.length;
    data.special = data.special ?? this.special;
    data.collate = data.collate ?? this.collate;
    data.null = data.null ?? this.null;
    data.default = data.default ?? (this.vs.Default !== null ? this.vs.Default : false);
    data.autoincrement = data.autoincrement ?? this.isAutoIncrement();

    if (data.type === "text" && this.type !== "text") {
      const hasIndex = await this.db.row(`SHOW INDEX FROM ${this.table} WHERE KEY_NAME = '${this}'`);
      if (hasIndex) await this.db.query(`ALTER TABLE ${this.table} DROP INDEX ${this}`);
    }

    let sql = `ALTER TABLE ${this.table} CHANGE \`${this}\` \`${data.name ?? this}\` ${Db._array_to_column_definition(data)}`;
    if (data.after !== undefined) sql += data.after ? ` AFTER \`${data.after}\`` : " FIRST";
    await this.db.query(sql);
    this.#special = data.special;
    await this.table.reloadFields();
  }

  get type(): string {
    this.#explodeTypeData();
    return this.#type!;
  }
  async setType(v: string): Promise<void> {
    await this.#change({ type: v });
    this.#type = v;
  }
  get length(): string {
    this.#explodeTypeData();
    return this.#length!;
  }
  async setLength(v: string): Promise<void> {
    await this.#change({ length: v });
    this.#length = v;
  }
  get special(): string {
    this.#explodeTypeData();
    return this.#special!;
  }
  async setSpecial(v: string): Promise<void> {
    await this.#change({ special: v });
    this.#special = v;
  }
  get null(): boolean {
    return this.vs.Null === "YES";
  }
  async setNull(v: boolean): Promise<void> {
    await this.#change({ null: v });
    this.vs.Null = v ? "YES" : "NO";
  }
  get default(): unknown {
    return this.vs.Default;
  }
  async setDefault(v: any): Promise<void> {
    await this.#change({ default: v });
  }
  get collate(): string {
    return this.vs.Collation ?? "";
  }
  async setCollate(v: string): Promise<void> {
    await this.#change({ collate: v });
    this.vs.Collate = v;
  }
  async setAutoincrement(v: boolean): Promise<void> {
    await this.#change({ autoincrement: v });
  }

  get id(): number {
    return this.vs.id;
  }
  parent(): DbTable | false {
    return this.vs.parent ? this.db.table(this.vs.parent) : false;
  }
  parentField(): DbField | false {
    const P = this.parent();
    if (!P) return false;
    return this.vs.parent_field ? P.field(this.vs.parent_field) : P.primary;
  }
  async setAfter(F: any): Promise<void> {
    await this.#change({ after: F });
  }
  async setKey(type: string): Promise<void> {
    type = type.toUpperCase();
    if (this.key === type) return;
    if (type === "PRI") {
      await this.#setPrimary(true);
    } else {
      await this.#setPrimary(false);
      if (this.key) {
        await this.db.query(`ALTER TABLE ${this.table} DROP INDEX \`${this}\``);
      }
      if (type === "MUL") {
        const t = this.type;
        if (["text", "tinytext", "mediumtext", "longtext"].includes(t)) {
          await this.db.query(`ALTER TABLE ${this.table} ADD FULLTEXT (\`${this}\`)`);
        } else {
          await this.db.query(`ALTER TABLE ${this.table} ADD INDEX (\`${this}\`)`);
        }
      } else if (type === "UNI") {
        await this.db.query(`ALTER TABLE ${this.table} ADD UNIQUE (\`${this}\`)`);
      }
    }
    await this.table.reloadFields();
  }
  async #setPrimary(v: boolean): Promise<void> {
    if (!!this.isPrimary() === v) return;
    const ps: Record<string, string> = {};
    let Auto: DbField | undefined;
    for (const [field, Field] of Object.entries(this.table.primaries)) {
      ps[field] = field;
      if (Field.isAutoIncrement()) {
        Auto = Field;
        await Field.setAutoincrement(false);
      }
    }
    if (Object.keys(ps).length) await this.db.query(`ALTER TABLE ${this.table} DROP PRIMARY KEY`);

    if (v) {
      ps[String(this)] = String(this);
      this.vs.Key = "PRI";
    } else {
      delete ps[String(this)];
      this.vs.Key = "";
    }
    if (Object.keys(ps).length) {
      await this.db.query(`ALTER TABLE ${this.table} ADD PRIMARY KEY (${Object.keys(ps).join(",")})`);
    }
    if (Auto) await Auto.setAutoincrement(true);
  }
}
