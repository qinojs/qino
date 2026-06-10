// deno-lint-ignore-file no-explicit-any

import { DbField } from "./DbField.ts";
import { type DbEntry, getEntryClass } from "./DbEntry.ts";
import { Db, numTypes } from "./Db.ts";

export class DbTable {
  #fields: Record<string, DbField> | null = null;
  #primaries: Record<string, DbField> = {};
  #autoIncrement: DbField | false = false;
  #db: Db;
  #name: string;
  #children: DbField[] | null = null;
  // Per-table identity map; WeakRef lets the GC reclaim unreferenced entries, finalizer drops the dead key.
  #entries = new Map<string, WeakRef<DbEntry>>();
  #entryFinalizer = new FinalizationRegistry<string>((eid) => {
    if (!this.#entries.get(eid)?.deref()) this.#entries.delete(eid);
  });

  constructor(db: Db, name: string) {
    this.#db = db;
    this.#name = name;
  }

  get db(): Db { return this.#db; }
  get fields(): Record<string, DbField> | null { return this.#fields; }
  get autoIncrement(): DbField | false { return this.#autoIncrement; }
  get schema(): Record<string, any> { return this.#db.schema?.properties?.[String(this)] ?? {}; }
  get primaries(): Record<string, DbField> { return this.#primaries; }
  get primary(): DbField | false { return Object.values(this.#primaries)[0] ?? false; }
  get name(): string { return this.#name; }
  get children(): DbField[] {
    if (this.#children === null) {
      this.#children = [];
      for (const table of Object.values(this.#db.tables ?? {})) {
        for (const [name, schema] of Object.entries(table.schema.additionalProperties?.properties ?? {})) {
          if ((schema as any)["x-qg-parent"] !== String(this)) continue;
          const field = table.field(name);
          if (field) this.#children.push(field);
        }
      }
    }
    return this.#children;
  }

  async reloadFields(): Promise<void> {
    this.#fields = null;
    this.#children = null;
    await this.init();
  }

  field(n: string): DbField | false { return this.#fields?.[n] ?? false; }

  async init(): Promise<Record<string, DbField>> {
    if (this.#fields === null) {
      const fields: Record<string, any>[] = [];

      const columns = await this.#db.query(`SHOW FULL COLUMNS FROM ${Db.escapeId(String(this))}`);
      for (const values of columns) {
        fields.push(values);
      }
      this.#fields = {};
      this.#primaries = {};
      this.#autoIncrement = false;
      for (const field of fields) {
        const name = field.Field;
        this.#fields[name] = new DbField(this, name, field);
        if (this.#fields[name].isPrimary()) {
          this.#primaries[name] = this.#fields[name];
        }
        if (this.#fields[name].isAutoIncrement()) {
          this.#autoIncrement = this.#fields[name];
        }
      }
    }
    return this.#fields!;
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
      const type = Field.type.toUpperCase();
      if (numTypes[type]) value = String(parseFloat(String(value)));
      part.push(value);
    }
    return part.join("-:-");
  }
  entryId2Array(id: any): Record<string, any> | false {
    const arr: Record<string, any> = {};
    if (id != null && typeof id === "object") {
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
    const values = this.entryId2Array(id);
    if (!values) return;
    const [where, params] = this.valuesToFragment(values);
    if (!where) return;
    const rows = await this.#db.all(`SELECT * FROM ${Db.escapeId(String(this))} WHERE ${where}`, params);
    return rows[0];
  }
  async select(v = "1", params: unknown[] = []): Promise<Record<string, Record<string, any>>> {
    const ret: Record<string, Record<string, any>> = {};
    const rows = await this.#db.all(`SELECT * FROM ${Db.escapeId(String(this))} WHERE ${v}`, params);
    for (const entry of rows) {
      const eid = this.entryId(entry);
      if (eid !== false) ret[eid] = entry;
    }
    return ret;
  }

  valuesToFragment(values: Record<string, any>, alias?: string, isSet = false): [string, unknown[]] {
    const sqls: string[] = [], params: unknown[] = [];
    for (const [field, Field] of Object.entries(this.#fields!)) {
      if (!(field in values)) continue;
      const value = Field.valueTransform(values[field]);
      const ref = alias ? `${Db.escapeId(alias)}.${Db.escapeId(field)}` : Db.escapeId(field);
      if (!isSet && value === null) {
        sqls.push(`${ref} IS NULL`);
        continue;
      }
      sqls.push(`${ref} = ?`);
      params.push(value);
    }
    return [isSet ? sqls.join(", ") : sqls.join(" AND "), params];
  }

  async insert(values: Record<string, any> = {}): Promise<string | false> {
    const eBefore: any = { Table: this, data: values, returnValue: undefined };
    await this.#db.fire("table::insert-before", eBefore);
    if (eBefore.returnValue !== undefined) return eBefore.returnValue;
    const [set, params] = this.valuesToFragment(values, undefined, true);
    const res = await this.#db.exec(`INSERT INTO ${Db.escapeId(String(this))}${set ? " SET " + set : " () VALUES ()"}`, params);
    if (!res.affectedRows) return false;
    const auto = this.autoIncrement;
    if (auto) values[String(auto)] = res.insertId;
    else if (res.insertId && this.primary && !(String(this.primary) in values)) values[String(this.primary)] = res.insertId;
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
    const [set, setParams] = this.valuesToFragment(values!, undefined, true);
    if (set) {
      const whereValues = this.entryId2Array(id);
      if (!whereValues) return false;
      const [where, whereParams] = this.valuesToFragment(whereValues);
      if (!where) return false;
      const rows = await this.#db.exec(`UPDATE ${Db.escapeId(String(this))} SET ${set} WHERE ${where}`, [...setParams, ...whereParams]) as any;
      if (!rows) return false;
      if (!rows.affectedRows) return String(id);
      await this.#db.fire("table::update-after", { Table: this, id, data: values });
      return String(id);
    }
    return undefined;
  }

  async ensure(values: Record<string, any> = {}): Promise<string | false | undefined> {
    const whereValues = this.entryId2Array(values);
    const where = whereValues ? this.valuesToFragment(whereValues) : null;
    if (where?.[0] && await this.#db.row(`SELECT * FROM ${Db.escapeId(String(this))} WHERE ${where[0]}`, where[1])) {
      return this.update(values);
    } else {
      return this.insert(values);
    }
  }

  async copy(id: any, override: Record<string, any> = {}, visiting: Set<string> = new Set()): Promise<string | false> {
    id = this.entryId(id);
    if (id === false) return false;
    const key = `${this}:${id}`;
    if (visiting.has(key)) return false;
    visiting.add(key);

    const row = await this.selectByID(id);
    if (!row) return false;
    if (this.autoIncrement) delete row[String(this.autoIncrement)];
    const newId = await this.insert({ ...row, ...override });
    if (newId === false) return false;

    for (const Field of this.children) {
      if (Field.onParentCopy !== "cascade") continue;
      const childRows = await this.#db.all(
        `SELECT * FROM ${Db.escapeId(String(Field.table))} WHERE ${Db.escapeId(String(Field))} = ?`, [id],
      );
      for (const childRow of childRows) await Field.table.copy(childRow, { [String(Field)]: newId }, visiting);
    }
    return newId;
  }

  async delete(id: any): Promise<boolean | undefined> {
    id = this.entryId(id);
    const values = this.entryId2Array(id);
    const eBefore: any = { Table: this, data: values, id, returnValue: undefined };
    await this.#db.fire("table::delete-before", eBefore);
    if (eBefore.returnValue !== undefined) return eBefore.returnValue;
    const where = values ? this.valuesToFragment(values) : null;
    if (!where?.[0]) return false;
    const rows = await this.#db.exec(`DELETE FROM ${Db.escapeId(String(this))} WHERE ${where[0]}`, where[1]) as any;
    if (!rows?.affectedRows) return undefined;
    await this.#db.fire("table::delete-after", { Table: this, data: values, id });
    for (const Field of this.children) {
      if (Field.onParentDelete === "cascade") {
        const childRows = await this.#db.all(
          `SELECT * FROM ${Db.escapeId(String(Field.table))} WHERE ${Db.escapeId(String(Field))} = ?`,
          [id],
        );
        for (const row of childRows) {
          await Field.table.delete(row);
        }
      }
    }
    return true;
  }

  async deleteWhere(values: Record<string, any> | string): Promise<void> {
    let rows: Record<string, Record<string, any>>;
    if (typeof values === "string") {
      rows = await this.select(values);
    } else {
      const [where, params] = this.valuesToFragment(values);
      rows = where ? await this.select(where, params) : {};
    }
    for (const row of Object.values(rows)) await this.delete(row);
  }

  entry(id?: any): DbEntry {
    const table = String(this);
    const Cl = getEntryClass(table);

    if (id instanceof Cl) return id;
    if (id === undefined) {
      throw new Error("not working sync without id (generate)");
      // const Entry = new Cl(this);
      // this.#entries.set(String(Entry), new WeakRef(Entry));
      // return Entry;
    }

    const isCompositeId = Array.isArray(id) || (id != null && typeof id === "object");
    const values = isCompositeId ? id : this.entryId2Array(id);
    const eid = isCompositeId ? String(this.entryId(id)) : String(id);

    const hit = this.#entries.get(eid)?.deref();
    if (hit) return hit;

    const entry = new Cl(this, values);
    this.#entries.set(eid, new WeakRef(entry));
    this.#entryFinalizer.register(entry, eid);
    return entry;
  }

  async selectEntries(str = ""): Promise<Record<string, DbEntry>> {
    const Es: Record<string, any> = {};
    const rows = await this.#db.query(`SELECT * FROM ${Db.escapeId(String(this))} ${str}`);
    for (const row of rows) {
      const entry = this.entry(row);
      Es[String(entry)] = entry;
    }
    return Es;
  }

  /** @deprecated unsafe, use valuesToFragment */
  valuesToWhere(values: Record<string, any>, alias?: string): string {
    const sqls: string[] = [];
    for (const [field, Field] of Object.entries(this.#fields!)) {
      if (!(field in values)) continue;
      const v = Field.valueToSql(values[field]);
      const f = alias ? `${Db.escapeId(alias)}.${Db.escapeId(field)}` : Db.escapeId(field);
      const equal = v === "NULL" ? " IS " : " = ";
      sqls.push(f + equal + v);
    }
    return sqls.join(" AND ");
  }
  /** @deprecated unsafe, use valuesToFragment */
  valuesToSet(values: Record<string, any>, alias?: string): string {
    return this.valuesToFragment(values, alias, true)[0];
  }

  toString(): string { return this.#name; }

}
