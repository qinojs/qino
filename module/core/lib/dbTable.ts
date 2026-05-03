/**
 * dbTable.ts - Database table ORM
 * Port of core/lib/dbTable.class.php
 */
// deno-lint-ignore-file no-explicit-any

import { dbField } from "./dbField.ts";
import { dbEntry, getEntryClass } from "./dbEntry.ts";
import { getCtx } from "qg";
import { DB } from "./db.ts";

export class dbTable {
  #fields: Record<string, dbField> | null = null;
  #primaries: Record<string, dbField> = {};
  #autoIncrement: dbField | false = false;
  #db: DB;
  #name: string;
  #children: dbField[] | null = null;

  constructor(db: DB, name: string) {
    this.#db = db;
    this.#name = name;
  }

  get db(): DB {
    return this.#db;
  }
  get fields(): Record<string, dbField> | null {
    return this.#fields;
  }
  get autoIncrement(): dbField | false {
    return this.#autoIncrement;
  }

  async reloadFields(): Promise<void> {
    this.#fields = null;
    this.#children = null;
    await this.init();
  }

  field(n: string): dbField | false {
    return this.#fields?.[n] ?? false;
  }

  async init(): Promise<Record<string, dbField>> {
    if (this.#fields === null) {
      const fields = [];

      const columns = await this.#db.query(`SHOW FULL COLUMNS FROM ${DB.escapeId(String(this))}`);
      for (const values of columns) {
        const name = values.Field;
        fields.push({ ...values, ...this.#db.fieldMeta(String(this), name) });
      }
      this.#fields = {};
      this.#primaries = {};
      this.#autoIncrement = false;
      for (const field of fields) {
        const name = field.Field;
        this.#fields[name] = new dbField(this, name, field);
        if (this.#fields[name].isPrimary()) {
          this.#primaries[name] = this.#fields[name];
        }
        if (this.#fields[name].isAutoIncrement()) {
          this.#autoIncrement = this.#fields[name];
        }
      }
      // Remove temp field if others exist
      if (this.#fields["_qgtmp"] && Object.keys(this.#fields).length > 1) {
        await this.remField("_qgtmp");
      }
    }
    return this.#fields!;
  }

  get primaries(): Record<string, dbField> {
    return this.#primaries;
  }
  get primary(): dbField | false {
    return Object.values(this.#primaries)[0] ?? false;
  }

  getStatus(): Promise<Record<string, any> | undefined> {
    return this.#db.row("SHOW TABLE STATUS LIKE ?", [String(this)]);
  }
  async getNextId(): Promise<number> {
    const s = await this.getStatus();
    return s ? parseInt(s.Auto_increment) : 1;
  }

  entryId(vs: any): string | false {
    if (!Array.isArray(vs) && typeof vs !== "object") return String(vs);
    const part: string[] = [];
    for (const [primary, Field] of Object.entries(this.#primaries)) {
      if (!(primary in vs)) {
        console.warn("db-table-entryId: too few fields");
        return false;
      }
      let value = vs[primary];
      const type = Field.getType().toUpperCase();
      if (dbField.numTypes[type]) value = String(parseFloat(String(value)));
      part.push(value);
    }
    return part.join("-:-");
  }
  entryId2Array(id: any): Record<string, any> | false {
    const arr: Record<string, any> = {};
    if (typeof id === "object" && id !== null) {
      for (const primary of Object.keys(this.#primaries)) {
        if (!(primary in id)) return false;
        arr[primary] = id[primary];
      }
    } else {
      const vs = String(id).split("-:-");
      let i = 0;
      for (const primary of Object.keys(this.#primaries)) {
        arr[primary] = vs[i++];
      }
    }
    return arr;
  }
  entryId2where(id: any, tAlias?: string): string | false {
    const values = this.entryId2Array(id);
    if (!values) return false;
    return this.valuesToWhere(values, tAlias);
  }

  async selectByID(id: any): Promise<Record<string, any> | undefined> {
    const where = this.entryId2where(id);
    if (!where) return;
    const rows = await this.select(where);
    return Object.values(rows)[0];
  }
  async select(v = "1"): Promise<Record<string, Record<string, any>>> {
    const ret: Record<string, Record<string, any>> = {};
    const rows = await this.#db.all(`SELECT * FROM ${DB.escapeId(String(this))} WHERE ${v}`);
    for (const entry of rows) {
      const eid = this.entryId(entry);
      if (eid !== false) ret[eid] = entry;
    }
    return ret;
  }

  #valuesToFragment(values: Record<string, any>, alias?: string, isSet = false): [string, unknown[]] {
    const sqls: string[] = [], params: unknown[] = [];
    for (const [field, Field] of Object.entries(this.#fields!)) {
      if (!(field in values)) continue;
      const value = Field.valueTransform(values[field]);
      const ref = alias ? `${DB.escapeId(alias)}.${DB.escapeId(field)}` : DB.escapeId(field);
      if (!isSet && value === null) {
        sqls.push(`${ref} IS NULL`);
        continue;
      }
      sqls.push(`${ref} = ?`);
      params.push(value);
    }
    return [isSet ? sqls.join(", ") : sqls.join(" AND "), params];
  }
  #valuesToSqls(values: Record<string, any>, alias?: string, isSet = false): string[] {
    const sqls: string[] = [];
    for (const [field, Field] of Object.entries(this.#fields!)) {
      if (!(field in values)) continue;
      const v = Field.valueToSql(values[field]);
      const f = alias ? `${DB.escapeId(alias)}.${DB.escapeId(field)}` : DB.escapeId(field);
      const equal = !isSet && v === "NULL" ? " IS " : " = ";
      sqls.push(f + equal + v);
    }
    return sqls;
  }
  valuesToWhere(values: Record<string, any>, alias?: string): string {
    return this.#valuesToSqls(values, alias).join(" AND ");
  }
  valuesToSet(values: Record<string, any>, alias?: string): string {
    return this.#valuesToSqls(values, alias, true).join(", ");
  }

  async insert(values: Record<string, any> = {}): Promise<string | false> {
    const eBefore: any = { Table: this, data: values, returnValue: undefined };
    await this.#db.fire("table::insert-before", eBefore);
    if (eBefore.returnValue !== undefined) return eBefore.returnValue;
    const [set, params] = this.#valuesToFragment(values, undefined, true);
    const res = await this.#db.exec(`INSERT INTO ${DB.escapeId(String(this))}${set ? " SET " + set : " () VALUES ()"}`, params);
    if (!res.affectedRows) return false;
    const auto = this.autoIncrement;
    if (auto) {
      values[String(auto)] = res.insertId;
    }
    const id = this.entryId(values);
    await this.#db.fire("table::insert-after", { Table: this, id, data: values });
    return id !== false ? String(id) : false;
  }

  async update(idOrValues: any, values?: Record<string, any>): Promise<string | false | undefined> {
    let id: any;
    if (values === undefined) {
      values = idOrValues;
      id = this.entryId(values!);
    } else {
      id = idOrValues;
    }
    const eBefore: any = { Table: this, id, data: values, returnValue: undefined };
    await this.#db.fire("table::update-before", eBefore);
    if (eBefore.returnValue !== undefined) return eBefore.returnValue;
    const [set, setParams] = this.#valuesToFragment(values!, undefined, true);
    if (set) {
      const whereValues = this.entryId2Array(id);
      if (!whereValues) return false;
      const [where, whereParams] = this.#valuesToFragment(whereValues);
      if (!where) return false;
      const rows = await this.#db.exec(`UPDATE ${DB.escapeId(String(this))} SET ${set} WHERE ${where}`, [...setParams, ...whereParams]) as any;
      if (!rows) return false;
      if (!rows.affectedRows) return String(id);
      await this.#db.fire("table::update-after", { Table: this, id, data: values });
      return String(id);
    }
    return undefined;
  }

  async ensure(values: Record<string, any> = {}): Promise<string | false | undefined> {
    const whereValues = this.entryId2Array(values);
    const where = whereValues ? this.#valuesToFragment(whereValues) : null;
    if (where?.[0] && await this.#db.row(`SELECT * FROM ${DB.escapeId(String(this))} WHERE ${where[0]}`, where[1])) {
      return this.update(values);
    } else {
      return this.insert(values);
    }
  }

  async delete(id: any): Promise<boolean | undefined> {
    id = this.entryId(id);
    const values = this.entryId2Array(id);
    const eBefore: any = { Table: this, data: values, id, returnValue: undefined };
    await this.#db.fire("table::delete-before", eBefore);
    if (eBefore.returnValue !== undefined) return eBefore.returnValue;
    const where = values ? this.#valuesToFragment(values) : null;
    if (!where?.[0]) return false;
    const rows = await this.#db.exec(`DELETE FROM ${DB.escapeId(String(this))} WHERE ${where[0]}`, where[1]) as any;
    if (!rows?.affectedRows) return undefined;
    await this.#db.fire("table::delete-after", { Table: this, data: values, id });
    for (const Field of this.children) {
      if (Field.vs.on_parent_delete === "cascade") {
        const childRows = await this.#db.all(
          `SELECT * FROM ${DB.escapeId(String(Field.Table))} WHERE ${DB.escapeId(String(Field))} = ?`,
          [id],
        );
        for (const row of childRows) {
          await Field.Table.delete(row);
        }
      }
    }
    return true;
  }

  async deleteWhere(values: Record<string, any> | string): Promise<void> {
    const where = typeof values === "string" ? values : this.valuesToWhere(values);
    const rows = await this.select(where);
    for (const row of Object.values(rows)) await this.delete(row);
  }

  #getChildren(): dbField[] {
    console.log("deprecated: dbTable.#getChildren(), use dbTable.children instead");    
    return this.children;
  }

  get children(): dbField[] {
    if (this.#children === null) {
      this.#children = [];
      for (const child of this.#db.childFields(String(this))) {
        const table = this.#db.table(child.table);
        const field = table.field(child.field);
        if (field) this.#children.push(field);
      }
    }
    return this.#children;
  }

  toString(): string { return this.#name; }
  get name(): string { return this.#name; }

  Entry(id?: any): dbEntry {
    const ctx = getCtx();
    const t = String(this);

    if (!ctx.entryCache.has(t)) ctx.entryCache.set(t, new Map());
    const tableCache = ctx.entryCache.get(t)!;

    const Cl = getEntryClass(t);

    if (id instanceof Cl) return id;
    if (id === undefined) {
      throw new Error("not working sync without id (generate)");
      // const Entry = new Cl(this);
      // const eid = String(Entry);
      // tableCache.set(eid, Entry);
      // return Entry;
    }

    const values = Array.isArray(id) || (typeof id === "object" && id !== null) ? id : this.entryId2Array(id);
    const eid = Array.isArray(id) || (typeof id === "object" && id !== null) ? String(this.entryId(id)) : String(id);

    if (!tableCache.has(eid)) {
      tableCache.set(eid, new Cl(this, values));
    }
    return tableCache.get(eid) as dbEntry;
  }

  async selectEntries(str = ""): Promise<Record<string, any>> {
    const Es: Record<string, any> = {};
    const rows = await this.#db.query(`SELECT * FROM ${DB.escapeId(String(this))} ${str}`);
    for (const row of rows) {
      const Entry = await this.Entry(row);
      Es[String(Entry)] = Entry;
    }
    return Es;
  }

  async addField(data: string | Record<string, any>): Promise<dbField | false> {
    if (typeof data === "string") data = { name: data };
    data = { type: "varchar", length: 255, null: false, ...data };
    await this.#db.exec(`ALTER TABLE ${DB.escapeId(String(this))} ADD ${DB.escapeId(String(data.name))} ${DB._array_to_column_definition(data)}`);
    await this.reloadFields();
    return this.#fields?.[data.name] ?? false;
  }
  async remField(name: string): Promise<void> {
    await this.#db.exec(`ALTER TABLE ${DB.escapeId(String(this))} DROP ${DB.escapeId(name)}`);
    if (this.#fields) {
      delete this.#fields[name];
      delete this.#primaries[name];
      if (this.#autoIncrement && String(this.#autoIncrement) === name) {
        this.#autoIncrement = false;
      }
    }
    this.#children = null;
  }
}
