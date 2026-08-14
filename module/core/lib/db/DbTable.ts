// deno-lint-ignore-file no-explicit-any
import { DbField } from "./DbField.ts";
import { anonRowClass, DbRow } from "./DbRow.ts";
import { NUM_TYPES } from "./Db.ts";
import { sql, isTemplate } from "../../deps.ts";

import type { Sql } from "../../deps.ts";
import type { Db } from "./Db.ts";

// One primary value as its canonical id part; undefined if it cannot identify a row.
const idValue = (field: DbField, value: any): string | undefined => {
  if (value == null || typeof value === "object") return; // String([]) and Number([]) would pass as ids
  if (!NUM_TYPES.has(field.type)) return String(value);
  const num = value === "" ? NaN : Number(value); // strict like DbField; an empty value is no id
  return Number.isFinite(num) ? String(num) : undefined;
};

export class DbTable {
  #fields: Record<string, DbField> | null = null;
  #primaries: DbField[] = []; // in id-part order
  #autoIncrement: DbField | undefined;
  #db: Db;
  #name: string;
  #children: DbField[] | null = null;

  constructor(db: Db, name: string) {
    this.#db = db;
    this.#name = name;
  }

  get db(): Db { return this.#db; }
  get fields(): Record<string, DbField> | null { return this.#fields; }
  get autoIncrement(): DbField | undefined { return this.#autoIncrement; }
  get schema(): Record<string, any> { return this.#db.schema?.properties?.[String(this)] ?? {}; }
  get primaries(): DbField[] { return this.#primaries; }
  get primary(): DbField | undefined { return this.#primaries[0]; }
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

  /** Read the column metadata. Built aside and swapped in, so nothing ever sees a table
   *  that has lost its fields while the introspection query is in flight. */
  async reloadFields(): Promise<void> {
    const fields: Record<string, DbField> = {};
    const primaries = [];
    let autoIncrement: DbField | undefined;
    for (const vs of await this.#db.columns(this.#name)) {
      const field = fields[vs.Field] = new DbField(this, vs.Field, vs);
      if (field.isPrimary()) primaries.push(field);
      if (field.isAutoIncrement()) autoIncrement = field;
    }
    this.#fields = fields;
    this.#primaries = primaries;
    this.#autoIncrement = autoIncrement;
    this.#children = null;
  }

  field(n: string): DbField | undefined { return this.#fields?.[n]; }

  async init(): Promise<Record<string, DbField>> {
    if (this.#fields === null) await this.reloadFields();
    return this.#fields!;
  }

  /** Canonical id of a row, values object or raw id; undefined if it identifies no row. */
  entryId(vs: any): string | undefined {
    const values = (vs != null && typeof vs === "object" ? vs : this.entryIdValues(vs)) ?? {};
    const primaries = this.#primaries;
    const composite = primaries.length > 1; // encoding only disambiguates the ":" separator, so single-primary ids stay raw
    const parts = [];
    for (const field of primaries) {
      const value = idValue(field, values[field.name]);
      if (value === undefined) { console.warn(`db-table-entryId: missing or invalid id for ${this}.${field}:`, vs); return; }
      parts.push(composite && !NUM_TYPES.has(field.type) ? encodeURIComponent(value) : value); // numbers never contain ":" or "%"
    }
    return parts.join(":");
  }

  /** Primary values of an entry id (or row); undefined if the id is incomplete or invalid. */
  entryIdValues(id: any): Record<string, any> | undefined {
    const primaries = this.#primaries;
    const composite = primaries.length > 1;
    const str = id != null && typeof id === "object" ? undefined : String(id);
    const parts = str === undefined ? undefined : composite ? str.split(":") : [str]; // single primary keeps the whole raw string (may contain ":")
    if (parts && parts.length !== primaries.length) return; // an id names every primary exactly once
    const values: Record<string, any> = {};
    try { // ids travel in URLs: a malformed escape makes decodeURIComponent throw, but it is just an invalid id
      for (let i = 0; i < primaries.length; i++) {
        const field = primaries[i];
        const raw = !parts ? id[field.name] : composite && !NUM_TYPES.has(field.type) ? decodeURIComponent(parts[i]) : parts[i];
        const value = idValue(field, raw);
        if (value === undefined) return;
        values[field.name] = value;
      }
    } catch { return; }
    return values;
  }

  /** WHERE fragment that identifies the row(s) for an entry id; undefined if the id is incomplete. */
  entryIdToFragment(id: any, alias?: string): Sql | undefined {
    const values = this.entryIdValues(id);
    if (!values) return;
    const frag = this.valuesToFragment(values, alias);
    return frag.parts.length ? frag : undefined;
  }

  async selectByID(id: any): Promise<Record<string, any> | undefined> {
    const values = this.entryIdValues(id);
    if (!values) return;
    const where = this.valuesToFragment(values);
    if (!where.parts.length) return;
    return this.#db.row`SELECT * FROM ${sql.id(this)} WHERE ${where}`;
  }
  async select(where: Sql = sql`TRUE`): Promise<Record<string, Record<string, any>>> {
    const ret: Record<string, Record<string, any>> = {};
    const rows = await this.#db.query`SELECT * FROM ${sql.id(this)} WHERE ${where}`;
    for (const entry of rows) {
      const eid = this.entryId(entry);
      if (eid !== undefined) ret[eid] = entry;
    }
    return ret;
  }

  valuesToFragment(values: Record<string, any>, alias?: string, isSet = false): Sql {
    const frags = [];
    for (const [name, field] of Object.entries(this.#fields!)) {
      if (!(name in values)) continue;
      const value = field.valueTransform(values[name]);
      const ref = alias ? sql`${sql.id(alias)}.${sql.id(name)}` : sql.id(name);
      if (!isSet && value === null) { frags.push(sql`${ref} IS NULL`); continue; }
      frags.push(sql`${ref} = ${value}`);
    }
    return sql.join(frags, isSet ? ", " : " AND ");
  }

  async insert(values: Record<string, any> = {}): Promise<string | undefined> {
    const eBefore: any = { table: this, data: values, returnValue: undefined };
    await this.#db.fire("table:insert-before", eBefore);
    if (eBefore.returnValue !== undefined) return eBefore.returnValue;
    const cols = Object.keys(this.#fields!).filter((f) => f in values);
    // Standard `(cols) VALUES (?)`; the driver supplies its dialect-specific empty-row fragment.
    const into = cols.length
      ? sql`(${sql.join(cols.map((f) => sql.id(f)))}) VALUES (${sql.join(cols.map((f) => sql`${this.#fields![f].valueTransform(values[f])}`))})`
      : sql.raw(this.#db.emptyInsert);
    const auto = this.autoIncrement;
    const res = await this.#db.exec(sql`INSERT INTO ${sql.id(this)} ${into}`, String(auto || this.primary || ""));
    if (!res.affectedRows) return;
    if (auto && !this.#db.insertSyncsAutoIncrement && String(auto) in values) await this.#db.syncAutoIncrement(String(this), String(auto), Number(values[String(auto)]));
    if (auto) values[String(auto)] = res.insertId;
    else if (res.insertId && this.primary && !(String(this.primary) in values)) values[String(this.primary)] = res.insertId;
    const id = this.entryId(values);
    await this.#db.fire("table:insert-after", { table: this, id, data: values });
    return id;
  }

  async update(idOrValues: any, values?: Record<string, any>): Promise<string | undefined> {
    let id: any;
    if (values === undefined) {
      values = idOrValues;
      id = this.entryId(values!);
    } else {
      id = idOrValues;
    }
    const eBefore: any = { table: this, id, data: values, returnValue: undefined };
    await this.#db.fire("table:update-before", eBefore);
    if (eBefore.returnValue !== undefined) return eBefore.returnValue;
    const set = this.valuesToFragment(values!, undefined, true);
    if (!set.parts.length) return;
    const whereValues = this.entryIdValues(id);
    if (!whereValues) return;
    const where = this.valuesToFragment(whereValues);
    if (!where.parts.length) return;
    const rows = await this.#db.exec`UPDATE ${sql.id(this)} SET ${set} WHERE ${where}`;
    if (!rows?.affectedRows) return; // no row matched (drivers report matched rows, not changed)
    await this.#db.fire("table:update-after", { table: this, id, data: values! });
    return this.entryId(id);
  }

  async ensure(values: Record<string, any> = {}): Promise<string | undefined> {
    const whereValues = this.entryIdValues(values);
    const where = whereValues ? this.valuesToFragment(whereValues) : null;
    return where?.parts.length && await this.#db.row`SELECT * FROM ${sql.id(this)} WHERE ${where}`
      ? this.update(values)
      : this.insert(values);
  }

  copy(id: any, override: Record<string, any> = {}, visiting: Set<string> = new Set()): Promise<string | undefined> {
    return this.#db.transaction(() => this.#copy(id, override, visiting));
  }
  async #copy(id: any, override: Record<string, any>, visiting: Set<string>): Promise<string | undefined> {
    id = this.entryId(id);
    if (id === undefined) return;
    const key = `${this}:${id}`;
    if (visiting.has(key)) return;
    visiting.add(key);

    const row = await this.selectByID(id);
    if (!row) return;
    const newRow = { ...row, ...override };
    if (this.autoIncrement && !(String(this.autoIncrement) in override)) delete newRow[String(this.autoIncrement)];
    const newId = await this.insert(newRow); // insert fills generated ids into newRow
    if (newId === undefined) return;

    for (const field of this.children) {
      if (field.onParentCopy !== "cascade") continue;
      const pField = field.parentField();
      if (!pField) continue;
      const childRows = await this.#db.query`SELECT * FROM ${sql.id(field.table)} WHERE ${sql.id(field)} = ${row[String(pField)]}`;
      for (const childRow of childRows) await field.table.copy(childRow, { [String(field)]: newRow[String(pField)] }, visiting);
    }
    return newId;
  }

  delete(id: any): Promise<boolean> {
    return this.#db.transaction(() => this.#delete(id));
  }
  async #delete(id: any): Promise<boolean> {
    id = this.entryId(id);
    const values = this.entryIdValues(id);
    const eBefore: any = { table: this, data: values, id, returnValue: undefined };
    await this.#db.fire("table:delete-before", eBefore);
    if (eBefore.returnValue !== undefined) return eBefore.returnValue;
    if (!values) return false;
    const where = this.valuesToFragment(values);
    if (!where.parts.length) return false;
    const cascades = this.children.filter((f) => f.onParentDelete === "cascade");
    const setnulls = this.children.filter((f) => f.onParentDelete === "setnull");
    const row = cascades.length || setnulls.length ? await this.selectByID(id) : undefined; // parent values are gone after the DELETE
    const rows = await this.#db.exec`DELETE FROM ${sql.id(this)} WHERE ${where}`;
    if (!rows?.affectedRows) return false; // no row matched
    await this.#db.fire("table:delete-after", { table: this, data: values, id });
    for (const field of cascades) {
      const pField = field.parentField();
      if (!pField || !row) continue;
      const childRows = await this.#db.query`SELECT * FROM ${sql.id(field.table)} WHERE ${sql.id(field)} = ${row[String(pField)]}`;
      for (const childRow of childRows) await field.table.delete(childRow);
    }
    for (const field of setnulls) {
      const pField = field.parentField();
      if (!pField || !row) continue;
      await this.#db.exec`UPDATE ${sql.id(field.table)} SET ${sql.id(field)} = ${null} WHERE ${sql.id(field)} = ${row[String(pField)]}`;
    }
    return true;
  }

  deleteWhere(values: Record<string, any>): Promise<void> {
    return this.#db.transaction(() => this.#deleteWhere(values));
  }
  async #deleteWhere(values: Record<string, any>): Promise<void> {
    const where = this.valuesToFragment(values);
    const rows = where.parts.length ? await this.select(where) : {};
    for (const row of Object.values(rows)) await this.delete(row);
  }

  toString(): string { return this.#name; }

  /* --- rows ------------------------------------------------------------------------------- */

  /** Milliseconds a loaded row stays trusted; 0 disables time-based expiry. */
  rowTtl: number = 0;

  // Identity map: one object per row, so two lookups share one set of pending changes. WeakRef,
  // because lifetime is reachability — a row nobody holds may go, a dirty one is held by the
  // write queue until it lands.
  #rows = new Map<string, WeakRef<DbRow>>();
  #rowFinalizer = new FinalizationRegistry<string>((id) => {
    if (!this.#rows.get(id)?.deref()) this.#rows.delete(id);
  });

  // The class lives on the table, never in a module-global registry: several tenants run the same
  // module code in one runtime, and each needs its own mapping.
  #rowClass: typeof DbRow | null = null;

  /** The table's Row subclass — data and behaviour in one object. Assign it in a module's init().
   *  Nobody silently replaces someone else's class: a second module has to extend the first
   *  (`class X extends table.rowClass {}`), and only until the first row was handed out. */
  get rowClass(): typeof DbRow { return this.#rowClass ??= anonRowClass(this.#name); }
  set rowClass(cls: typeof DbRow) {
    const current = this.#rowClass;
    if (current && !(cls.prototype instanceof current)) throw new Error(`${this}: rowClass is already ${current.name} — a replacement must extend it`);
    if (this.#rows.size) throw new Error(`${this}: rows already exist — assign rowClass in init()`);
    this.#rowClass = cls;
  }

  /** Row handle, synchronous, without touching the database — it may be unloaded. */
  row<T extends DbRow = DbRow>(id: any): T {
    if (id instanceof DbRow) return id as T;
    const rowId = String(this.entryId(id) ?? id); // an unusable id keeps its raw key — that row simply never exists
    const hit = this.#rows.get(rowId)?.deref();
    if (hit) return hit as T;
    const row = new this.rowClass(this, rowId);
    this.#rows.set(rowId, new WeakRef(row));
    this.#rowFinalizer.register(row, rowId);
    return row as T;
  }

  // Second way into the identity map, for the tables that are looked up by something other than
  // their key (client.hash, log_ip.ip, page_url.url). Same WeakRef lifetime as #rows.
  #byValue = new Map<string, WeakRef<DbRow>>();
  #byFinalizer = new FinalizationRegistry<string>((key) => {
    if (!this.#byValue.get(key)?.deref()) this.#byValue.delete(key);
  });

  /** Loaded row found by a non-key column, or undefined. Repeated lookups of the same value are free.
   *  A value with no row is not remembered — the caller inserts it, and the next lookup indexes it. */
  async rowBy<T extends DbRow = DbRow>(field: string, value: any): Promise<T | undefined> {
    const key = `${field} ${value}`;
    const hit = this.#byValue.get(key)?.deref();
    if (hit && !hit.$stale) return hit as T;
    const vs = await this.#db.row`SELECT * FROM ${sql.id(this)} WHERE ${sql.id(field)} = ${value} LIMIT 1`;
    if (!vs) { this.#byValue.delete(key); return; }
    const row = this.row<T>(vs).$receive(vs);
    this.#byValue.set(key, new WeakRef(row));
    this.#byFinalizer.register(row, key);
    return row;
  }

  /** Loaded row, or undefined if there is none. Re-reads only when unloaded or stale. */
  async get<T extends DbRow = DbRow>(id: any): Promise<T | undefined> {
    const row = this.row<T>(id);
    if (row.$loaded && !row.$stale) return row.$exists ? row : undefined;
    return row.$read();
  }

  /** Loaded rows for a query tail — one SELECT, identity-mapped. */
  all<T extends DbRow = DbRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  all<T extends DbRow = DbRow>(tail?: Sql): Promise<T[]>;
  async all<T extends DbRow = DbRow>(a?: TemplateStringsArray | Sql, ...rest: unknown[]): Promise<T[]> {
    const tail = a == null ? sql.raw("") : isTemplate(a) ? sql(a, ...rest) : a;
    const rows = await this.#db.query`SELECT * FROM ${sql.id(this)} ${tail}`;
    return rows.map((vs) => this.row<T>(vs).$receive(vs));
  }

  /** Insert and return the loaded row — re-read, so defaults and generated columns are present. */
  async add<T extends DbRow = DbRow>(values: Record<string, any> = {}): Promise<T | undefined> {
    const id = await this.insert(values);
    if (id === undefined) return;
    return this.row<T>(id).$read();
  }

  /** A write went past a row object — tell the one we hold, if any. */
  invalidate(id: any, deleted = false): void {
    this.#rows.get(String(this.entryId(id) ?? id))?.deref()?.$invalidate(deleted);
  }

}
