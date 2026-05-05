/**
 * dbEntry.ts - Database record wrapper
 * Port of core/lib/dbEntry.class.php
 */

import type { dbTable } from "./dbTable.ts";

const entryClasses: Record<string, typeof dbEntry> = {};

export function registerEntryClass(tableName: string, cls: typeof dbEntry): void {
  entryClasses[tableName] = cls;
}

export function getEntryClass(tableName: string): typeof dbEntry {
  return entryClasses[tableName] ?? dbEntry;
}

export class dbEntry {
  protected _T: dbTable;
  private _is: boolean | null = null;
  private _full = false;
  private _vs: Record<string, any> = {};
  private _eid: string | false = false;
  private _changed = false;

  constructor(T: dbTable, vs?: any) {
    this._T = T;
    if (vs !== undefined && (Array.isArray(vs) || (typeof vs === "object" && vs !== null))) {
      this._eid = T.entryId(vs) || false;
      this._vs  = vs;
    } else if (vs === undefined) {
      this._eid = "";
    } else {
      console.error("dbEntry as direct id used?", Error().stack);
      this._eid = String(vs);
    }
  }

  protected construct(): void {}

  async is(): Promise<this | false> {
    if (this._is === null) await this.getVs();
    return this._is ? this : false;
  }

  async get(n: string): Promise<any> {
    if (!this._full) await this.getVs();
    if (n in this._vs) return this._vs[n];
    return this._get(n);
  }

  protected async _get(name: string): Promise<any> {
    if (await this.is()) {
      console.warn(`_get "${this._T}::${name}" not implemented`);
    } else {
      console.warn("Entry does not exists");
    }
  }

  private _fullCheck(): boolean {
    if (this._full) return true;
    if (!this._T.fields) return false;
    const nonPrimaries = Object.entries(this._T.fields)
      .filter(([, Field]) => !Field.isPrimary())
      .map(([field]) => field);
    if (!nonPrimaries.length) return false;
    this._full = nonPrimaries.every(field => field in this._vs);
    if (this._full) this._is = true;
    return this._full;
  }

  private _ensureEid(): void {
    if (this._eid === false && this._T.fields && Object.keys(this._vs).length > 0) {
      this._eid = this._T.entryId(this._vs) || false;
    }
  }

  async getVs(): Promise<Record<string, any>> {
    if (!this._fullCheck()) {
      this._ensureEid();
      const data = await this._T.selectByID(this._eid);
      this._is = !!data;
      if (data) this._vs = data;
      this._full = true;
    }
    return this._vs;
  }

  async setVs(vs: Record<string, any>): Promise<this> {
    await this.getVs();
    for (const [n, v] of Object.entries(vs)) await this.set(n, v);
    return this;
  }

  async set(n: string, v: any): Promise<void> {
    await this.getVs();
    if (n in this._vs) {
      const Field = this._T.field(n);
      if (Field) {
        v = Field.valueTransform(v);
        if (this._vs[n] !== v) this._changed = true;
      }
    }
    this._vs[n] = v;
    this.#scheduleSave();
  }

  __set(n: string, v: any): void {
    if (n in this._vs && this._vs[n] !== v) this._changed = true;
    this._vs[n] = v;
    this.#scheduleSave();
  }

  #saveTimer: number | undefined;
  #scheduleSave(): void {
    if (!this._changed) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => { this.save().catch(e => console.error("auto-save failed:", e)); }, 50) as unknown as number;
  }

  async makeIfNot(): Promise<this> {
    if (!(await this.is())) {
      const arr = this._T.entryId2Array(this._eid);
      if (arr) this._vs = arr;
      await this._T.insert(this._vs);
      this._full = false;
      this._is = true;
    }
    return this;
  }

  async delete(): Promise<void> {
    await this._T.delete(this._eid);
    this._eid = false;
    this._vs = {};
    this._is = false;
  }

  async save(): Promise<void> {
    if (this._changed) {
      await this._ensureEid();
      if (this._eid === false) throw new Error(`dbEntry.save(): _eid is false, cannot update`);
      await this._T.update(this._eid, this._vs);
      this._changed = false;
    }
  }

  toString(): string {
    return String(this._eid);
  }
}
