import type { DbTable } from "./DbTable.ts";

const entryClasses: Record<string, typeof DbEntry> = {};

export function registerEntryClass(tableName: string, cls: typeof DbEntry): void {
  entryClasses[tableName] = cls;
}

export function getEntryClass(tableName: string): typeof DbEntry {
  return entryClasses[tableName] ?? DbEntry;
}

export class DbEntry {
  protected table: DbTable;
  #is: boolean | null = null;
  #full = false;
  #vs: Record<string, any> = {};
  #eid: string | undefined;
  #changed = false;
  #savePending = false;

  constructor(table: DbTable, vs?: any) {
    this.table = table;
    if (Array.isArray(vs) || (vs != null && typeof vs === "object")) {
      this.#eid = table.entryId(vs) || undefined;
      this.#vs  = vs;
    } else if (vs === undefined) this.#eid = "";
    else {
      console.error("dbEntry as direct id used?", Error().stack);
      this.#eid = String(vs);
    }
  }

  async exists(): Promise<this | undefined> {
    if (this.#is === null) await this.values();
    return this.#is ? this : undefined;
  }

  async get(n: string): Promise<any> {
    if (!this.#full) await this.values();
    if (n in this.#vs) return this.#vs[n];
    if (await this.exists()) console.warn(`_get "${this.table}::${n}" not implemented`);
    else console.warn("Entry does not exist", Error().stack);
  }

  #fullCheck(): boolean {
    if (this.#full) return true;
    if (!this.table.fields) return false;
    const nonPrimaries = Object.entries(this.table.fields)
      .filter(([, field]) => !field.isPrimary())
      .map(([name]) => name);
    if (!nonPrimaries.length) return false;
    this.#full = nonPrimaries.every(field => field in this.#vs);
    if (this.#full) this.#is = true;
    return this.#full;
  }

  #ensureEid(): void {
    if (this.#eid === undefined && this.table.fields && Object.keys(this.#vs).length)
      this.#eid = this.table.entryId(this.#vs) || undefined;
  }

  async values(): Promise<Record<string, any>> {
    if (!this.#fullCheck()) {
      this.#ensureEid();
      const data = await this.table.selectByID(this.#eid);
      this.#is = !!data;
      if (data) this.#vs = data;
      this.#full = true;
    }
    return this.#vs;
  }

  async setVs(vs: Record<string, any>): Promise<this> {
    await this.values();
    for (const [n, v] of Object.entries(vs)) await this.set(n, v);
    return this;
  }

  async set(n: string, v: any): Promise<void> {
    await this.values();
    const field = this.table.field(n);
    // Unknown field: value is kept in memory but never persisted. Warn for now; throw once confirmed unused.
    if (!field) console.warn(`db-set "${this.table}::${n}": unknown field, value not persisted`);
    else if (n in this.#vs) {
      v = field.valueTransform(v);
      if (this.#vs[n] !== v) this.#changed = true;
    }
    this.#vs[n] = v;
    this.#scheduleSave();
  }

  // Microtask keeps the save inside the current transaction / request scope.
  #scheduleSave(): void {
    if (!this.#changed || this.#savePending) return;
    this.#savePending = true;
    queueMicrotask(() => { this.#savePending = false; this.save().catch(e => console.error("auto-save failed:", e)); });
  }

  async ensure(): Promise<this> {
    if (!(await this.exists())) {
      const arr = this.table.entryIdValues(this.#eid);
      if (arr) this.#vs = arr;
      await this.table.insert(this.#vs);
      this.#full = false;
      this.#is = true;
    }
    return this;
  }

  async delete(): Promise<void> {
    await this.table.delete(this.#eid);
    this.#eid = undefined;
    this.#vs = {};
    this.#is = false;
  }

  async save(): Promise<void> {
    if (!this.#changed) return;
    this.#ensureEid();
    if (this.#eid === undefined) throw new Error("dbEntry.save(): eid is unknown, cannot update");
    this.#changed = false; // before the await, so a concurrent save() can't double-update
    await this.table.update(this.#eid, this.#vs);
  }

  toString(): string {
    return String(this.#eid);
  }
}
