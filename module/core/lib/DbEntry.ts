/**
 * dbEntry.ts - Database record wrapper
 * Port of core/lib/dbEntry.class.php
 */

import type { DbTable } from "./DbTable.ts";

const entryClasses: Record<string, typeof DbEntry> = {};

export function registerEntryClass(tableName: string, cls: typeof DbEntry): void {
  entryClasses[tableName] = cls;
}

export function getEntryClass(tableName: string): typeof DbEntry {
  return entryClasses[tableName] ?? DbEntry;
}

export class DbEntry {
  protected _T: DbTable;
  #is: boolean | null = null;
  #full = false;
  #vs: Record<string, any> = {};
  #eid: string | false = false;
  #changed = false;

  constructor(T: DbTable, vs?: any) {
    this._T = T;
    if (vs !== undefined && (Array.isArray(vs) || (typeof vs === "object" && vs !== null))) {
      this.#eid = T.entryId(vs) || false;
      this.#vs  = vs;
    } else if (vs === undefined) {
      this.#eid = "";
    } else {
      console.error("dbEntry as direct id used?", Error().stack);
      this.#eid = String(vs);
    }
  }

  async is(): Promise<this | false> {
    if (this.#is === null) await this.getVs();
    return this.#is ? this : false;
  }

  async get(n: string): Promise<any> {
    if (!this.#full) await this.getVs();
    if (n in this.#vs) return this.#vs[n];
    if (await this.is()) console.warn(`_get "${this._T}::${n}" not implemented`);
    else console.warn("Entry does not exists");
  }

  #fullCheck(): boolean {
    if (this.#full) return true;
    if (!this._T.fields) return false;
    const nonPrimaries = Object.entries(this._T.fields)
      .filter(([, Field]) => !Field.isPrimary())
      .map(([field]) => field);
    if (!nonPrimaries.length) return false;
    this.#full = nonPrimaries.every(field => field in this.#vs);
    if (this.#full) this.#is = true;
    return this.#full;
  }

  #ensureEid(): void {
    if (this.#eid === false && this._T.fields && Object.keys(this.#vs).length > 0) {
      this.#eid = this._T.entryId(this.#vs) || false;
    }
  }

  async getVs(): Promise<Record<string, any>> {
    if (!this.#fullCheck()) {
      this.#ensureEid();
      const data = await this._T.selectByID(this.#eid);
      this.#is = !!data;
      if (data) this.#vs = data;
      this.#full = true;
    }
    return this.#vs;
  }

  async setVs(vs: Record<string, any>): Promise<this> {
    await this.getVs();
    for (const [n, v] of Object.entries(vs)) await this.set(n, v);
    return this;
  }

  async set(n: string, v: any): Promise<void> {
    await this.getVs();
    if (n in this.#vs) {
      const Field = this._T.field(n);
      if (Field) {
        v = Field.valueTransform(v);
        if (this.#vs[n] !== v) this.#changed = true;
      }
    }
    this.#vs[n] = v;
    this.#scheduleSave();
  }

  #saveTimer: number | undefined;
  #scheduleSave(): void {
    if (!this.#changed) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => { this.save().catch(e => console.error("auto-save failed:", e)); }, 50) as unknown as number;
  }

  async makeIfNot(): Promise<this> {
    if (!(await this.is())) {
      const arr = this._T.entryId2Array(this.#eid);
      if (arr) this.#vs = arr;
      await this._T.insert(this.#vs);
      this.#full = false;
      this.#is = true;
    }
    return this;
  }

  async delete(): Promise<void> {
    await this._T.delete(this.#eid);
    this.#eid = false;
    this.#vs = {};
    this.#is = false;
  }

  async save(): Promise<void> {
    if (this.#changed) {
      this.#ensureEid();
      if (this.#eid === false) throw new Error(`dbEntry.save(): _eid is false, cannot update`);
      await this._T.update(this.#eid, this.#vs);
      this.#changed = false;
    }
  }

  toString(): string {
    return String(this.#eid);
  }
}
