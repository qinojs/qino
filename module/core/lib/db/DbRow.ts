// deno-lint-ignore-file no-explicit-any
import { NUM_TYPES } from "./Db.ts";

import type { DbTable } from "./DbTable.ts";

// Everything `$`-prefixed belongs to the row layer, everything else is a column or a method of
// your subclass. So row-layer members never shadow a column, and `id`, `name`, `value`, `path`
// remain usable as column names.

const boundNames = new WeakMap<object, Set<string>>();

/** Tables without a registered class get their own empty subclass, so column accessors are not
 *  shared between tables via DbRow's prototype. */
export function anonRowClass(table: string): typeof DbRow {
  const cls = class extends DbRow {};
  Object.defineProperty(cls, "name", { value: table, configurable: true });
  return cls;
}

/** A base class already defines this column's accessor. */
function boundAbove(cls: typeof DbRow, name: string): boolean {
  for (let c = Object.getPrototypeOf(cls); c; c = Object.getPrototypeOf(c)) {
    if (boundNames.get(c)?.has(name)) return true;
  }
  return false;
}

/** Columns as accessors on the class, per column, so reloadFields() can add new ones. */
function bindColumns(cls: typeof DbRow, fields: Map<string, unknown>): void {
  let done = boundNames.get(cls);
  if (!done) boundNames.set(cls, done = new Set());
  if (done.size === fields.size) return;
  for (const name of fields.keys()) {
    if (done.has(name)) continue;
    if (boundAbove(cls, name)) { done.add(name); continue; } // inherited accessor
    if (name[0] === "$") throw new Error(`${cls.name}: column "${name}" starts with $, which the row layer reserves`);
    if (name in cls.prototype) throw new Error(`${cls.name}: column "${name}" collides with a member of the class — rename the member`);
    Object.defineProperty(cls.prototype, name, {
      get(this: DbRow) { return this.$get(name); },
      set(this: DbRow, v: unknown) { this.$set(name, v); },
    });
    done.add(name);
  }
}

export class DbRow {
  #table: DbTable;
  #id: string;
  #vs: Record<string, any> = {};
  #dirty = new Set<string>();
  #exists: boolean | null = null; // null: not looked up yet
  #loadedAt = 0;
  #stale = false;

  constructor(table: DbTable, id: string) {
    this.#table = table;
    this.#id = id;
    if (table.fields) bindColumns(this.constructor as typeof DbRow, table.fields);
  }

  get $table(): DbTable { return this.#table; }
  get $id(): string { return this.#id; }
  /** Values were loaded at least once (unlike $exists, which says whether the row exists). */
  get $loaded(): boolean { return this.#loadedAt > 0; }
  get $changed(): boolean { return !!this.#dirty.size; }
  /** Milliseconds since the values came from the database. */
  get $age(): number { return this.#loadedAt ? Date.now() - this.#loadedAt : Infinity; }
  /** The row was written via the table — values may be outdated. */
  get $stale(): boolean { return this.#stale || (this.#table.rowTtl > 0 && this.$age > this.#table.rowTtl); }
  /** Whether the row is in the database; null while unknown. */
  get $exists(): boolean | null { return this.#exists; }

  $get(name: string): any { return this.#vs[name]; }

  $set(name: string, value: unknown): void;
  $set(values: Record<string, unknown>): Promise<this>;
  $set(a: string | Record<string, unknown>, b?: unknown): any {
    if (typeof a === "string") return this.#assign(a, b);
    for (const [name, value] of Object.entries(a)) this.#assign(name, value);
    return this.$save(); // the object form returns a promise
  }

  #assign(name: string, value: unknown): void {
    const field = this.#table.field(name);
    if (!field) throw new Error(`${this.#table}.${name}: unknown column`);
    // valueTransform returns SQL strings; in memory a column must look like a SELECT returns it.
    let v = field.valueTransform(value);
    if (v !== null && NUM_TYPES.has(field.type)) v = Number(v);
    if (this.$loaded && this.#vs[name] === v) return;
    this.#vs[name] = v;
    this.#dirty.add(name);
    this.#table.db.markDirty(this); // holds the row until written
  }

  /** Values from the database; unsaved local changes win. */
  $receive(vs: Record<string, any> | undefined): this {
    const mine: Record<string, any> = {};
    for (const name of this.#dirty) mine[name] = this.#vs[name];
    this.#vs = { ...vs, ...mine };
    // Drivers return DECIMAL as string ("0.0100000000"); convert, so read and written values have
    // the same type.
    for (const name in this.#vs) {
      const value = this.#vs[name];
      if (typeof value !== "string" || !NUM_TYPES.has(this.#table.field(name)?.type ?? "")) continue;
      const num = Number(value);
      if (value !== "" && Number.isFinite(num)) this.#vs[name] = num;
    }
    this.#exists = !!vs;
    this.#loadedAt = Date.now();
    this.#stale = false;
    return this;
  }

  /** Written or deleted elsewhere — the next $read() reloads it. */
  $invalidate(deleted = false): void {
    this.#stale = true;
    if (deleted) this.#exists = false;
  }

  /** (Re-)load from the database. Pending changes are written first, never dropped. */
  async $read(): Promise<this | undefined> {
    await this.$save();
    this.$receive(await this.#table.selectByID(this.#id));
    return this.#exists ? this : undefined;
  }

  /** Write the changed columns, via the table (db events fire). */
  async $save(): Promise<this> {
    if (!this.#dirty.size) return this;
    const values: Record<string, any> = {};
    for (const name of this.#dirty) values[name] = this.#vs[name];
    this.#dirty.clear(); // before the await, so a parallel save doesn't write twice
    const stale = this.#stale;
    try {
      const id = await this.#table.update(this.#id, values);
      if (id === undefined) this.#exists = false; // nothing matched — the row is gone
    } catch (e) {
      for (const name of Object.keys(values)) this.#dirty.add(name); // keep them for a retry
      throw e;
    }
    this.#stale = stale; // our own update-after event must not mark it stale
    return this;
  }

  async $remove(): Promise<void> {
    this.#dirty.clear();
    await this.#table.delete(this.#id);
    this.#exists = false;
  }

  $values(): Record<string, any> { return { ...this.#vs }; }
  get $keys(): string[] { return Object.keys(this.#vs); }

  toJSON(): Record<string, any> { return this.$values(); }
  toString(): string { return this.#id; }
}
