/**
 * dbField.ts - Database field abstraction
 * Port of core/lib/dbField.class.php
 */

import type { dbTable } from "./dbTable.ts";
import { DB } from "./db.ts";

export class dbField {
  static dateTypes: Record<string, 1> = { DATETIME: 1, DATE: 1, TIMESTAMP: 1 };
  static stringTypes: Record<string, 1> = { CHAR: 1, VARCHAR: 1, BINARY: 1, VARBINARY: 1, BLOB: 1, TEXT: 1, ENUM: 1, SET: 1 };
  static numTypes: Record<string, 1> = { TINYINT: 1, SMALLINT: 1, MEDIUMINT: 1, INT: 1, BIGINT: 1, DECIMAL: 1, FLOAT: 1, DOUBLE: 1 };

  #type: string | null = null;
  #length: string | null = null;
  #special: string | null = null;
  #name: string;

  vs: Record<string, any>;
  Table: dbTable;
  Db: DB;

  constructor(Table: dbTable, name: string, vs: Record<string, any>) {
    this.Table = Table;
    this.Db = Table.db;
    this.#name = name;
    this.vs = vs;
  }

  toString(): string { return this.#name; }
  get name(): string { return this.#name; }

  valueTransform(value: any): any {
    const type = this.getType().toUpperCase();
    if (this.getNull() && value === null) return null;
    if (this.getNull() && value === "" && !dbField.stringTypes[type]) return null;
    if (typeof value === "number" && dbField.dateTypes[type]) {
      return new Date(value * 1000).toISOString().replace("T", " ").slice(0,19);
    }
    if (dbField.numTypes[type] && typeof value !== "number") {
      value = parseFloat(String(value)) || 0;
    }
    return String(value ?? "");
  }

  valueToSql(value: any): string {
    value = this.valueTransform(value);
    return value === null ? "NULL" : DB.quote(value); // DB.quote hier behalten!
  }

  isPrimary(): boolean { return this.vs.Key === "PRI"; }
  getKey(): string { return this.vs.Key ?? ""; }
  isAutoIncrement(): boolean { return this.vs.Extra === "auto_increment"; }

  private explodeTypeData(): void {
    if (this.#type === null) {
      const match = this.vs.Type?.match(/^([a-z]+)(\(([^)]+)\)|.*)(.*)$/i);
      this.#type = match ? match[1].toLowerCase().trim() : "varchar";
      this.#length = match ? (match[3] ?? "").trim() : "";
      this.#special = match ? (match[4] ?? "").trim().toLowerCase() : "";
    }
  }
  async change(data: Record<string, any>): Promise<void> {
    data.type = data.type ?? this.getType();
    data.length = data.length ?? this.getLength();
    data.special = data.special ?? this.getSpecial();
    data.collate = data.collate ?? this.getCollate();
    data.null = data.null ?? this.getNull();
    data.default = data.default ?? (this.vs.Default !== null ? this.vs.Default : false);
    data.autoincrement = data.autoincrement ?? this.isAutoIncrement();

    if (data.type === "text" && this.getType() !== "text") {
      const hasIndex = await this.Db.row(`SHOW INDEX FROM ${this.Table} WHERE KEY_NAME = '${this}'`);
      if (hasIndex) await this.Db.query(`ALTER TABLE ${this.Table} DROP INDEX ${this}`);
    }

    let sql = `ALTER TABLE ${this.Table} CHANGE \`${this}\` \`${data.name ?? this}\` ${DB._array_to_column_definition(data)}`;
    if (data.after !== undefined) sql += data.after ? ` AFTER \`${data.after}\`` : " FIRST";
    await this.Db.query(sql);
    this.#special = data.special;
    await this.Table.reloadFields();
  }

  getType(): string {
    this.explodeTypeData();
    return this.#type!;
  }
  async setType(v: string): Promise<void> {
    await this.change({ type: v });
    this.#type = v;
  }
  getLength(): string {
    this.explodeTypeData();
    return this.#length!;
  }
  async setLength(v: string): Promise<void> {
    await this.change({ length: v });
    this.#length = v;
  }
  getSpecial(): string {
    this.explodeTypeData();
    return this.#special!;
  }
  async setSpecial(v: string): Promise<void> {
    await this.change({ special: v });
    this.#special = v;
  }
  getNull(): boolean {
    return this.vs.Null === "YES";
  }
  async setNull(v: boolean): Promise<void> {
    await this.change({ null: v });
    this.vs.Null = v ? "YES" : "NO";
  }
  getDefault(): any {
    return this.vs.Default;
  }
  async setDefault(v: any): Promise<void> {
    await this.change({ default: v });
  }
  getCollate(): string {
    return this.vs.Collation ?? "";
  }
  async setCollate(v: string): Promise<void> {
    await this.change({ collate: v });
    this.vs.Collate = v;
  }
  getAutoincrement(): string {
    return this.isAutoIncrement() ? "true" : "false";
  }
  async setAutoincrement(v: boolean): Promise<void> {
    await this.change({ autoincrement: v });
  }

  getID(): number {
    return this.vs.id;
  }
  parent(): dbTable | false {
    return this.vs.parent ? this.Db.table(this.vs.parent) : false;
  }
  parentField(): dbField | false {
    const P = this.parent();
    if (!P) return false;
    return this.vs.parent_field ? P.field(this.vs.parent_field) : P.primary;
  }
  async setAfter(F: any): Promise<void> {
    await this.change({ after: F });
  }
  async setKey(type: string): Promise<void> {
    type = type.toUpperCase();
    if (this.getKey() === type) return;
    if (type === "PRI") {
      await this.#setPrimary(true);
    } else {
      await this.#setPrimary(false);
      if (this.getKey()) {
        await this.Db.query(`ALTER TABLE ${this.Table} DROP INDEX \`${this}\``);
      }
      if (type === "MUL") {
        const t = this.getType();
        if (["text", "tinytext", "mediumtext", "longtext"].includes(t)) {
          await this.Db.query(`ALTER TABLE ${this.Table} ADD FULLTEXT (\`${this}\`)`);
        } else {
          await this.Db.query(`ALTER TABLE ${this.Table} ADD INDEX (\`${this}\`)`);
        }
      } else if (type === "UNI") {
        await this.Db.query(`ALTER TABLE ${this.Table} ADD UNIQUE (\`${this}\`)`);
      }
    }
    await this.Table.reloadFields();
  }
  async #setPrimary(v: boolean): Promise<void> {
    if (!!this.isPrimary() === v) return;
    const ps: Record<string, string> = {};
    let Auto: dbField | undefined;
    for (const [field, Field] of Object.entries(this.Table.primaries)) {
      ps[field] = field;
      if (Field.isAutoIncrement()) {
        Auto = Field;
        await Field.setAutoincrement(false);
      }
    }
    if (Object.keys(ps).length) await this.Db.query(`ALTER TABLE ${this.Table} DROP PRIMARY KEY`);

    if (v) {
      ps[String(this)] = String(this);
      this.vs.Key = "PRI";
    } else {
      delete ps[String(this)];
      this.vs.Key = "";
    }
    if (Object.keys(ps).length) {
      await this.Db.query(`ALTER TABLE ${this.Table} ADD PRIMARY KEY (${Object.keys(ps).join(",")})`);
    }
    if (Auto) await Auto.setAutoincrement(true);
  }
}
