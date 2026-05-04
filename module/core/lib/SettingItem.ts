/**
 * settingArray.ts - Settings system
 * Port of core/lib/settingArray.class.php
 */

import { Item } from "../../../deps.ts";
import type { DB } from "./db.ts";

class SettingItem extends Item<SettingItem> {
  data: Record<string, unknown> | null = null;
  db!: DB;

  constructor(...args: ConstructorParameters<typeof Item>) {
    super(...args);
    if (this.io) this.io.options.ttl = 1000 * 60 * 60 * 2;
  }

  override reader = async () => {
    await this.parent?.read();

    // autovivif: create if they don't exist in db
    if (this.parent && !this.data?.id) {
      const parentId = this.parent.data?.id ?? 0;
      const offset = this.key;
      const result = await this.root.db.exec("INSERT INTO qg_setting (basis, `offset`, value) VALUES (?, ?, '')", [parentId, offset]);
      this.data = await this.root.db.row("SELECT * FROM qg_setting WHERE id = ?", [result.insertId]);
    }

    // fetch children
    const id = this.data?.id ?? 0;
    const rows = await this.root.db.all("SELECT * FROM qg_setting WHERE basis = ? ORDER BY `offset`", [id]);
    for (const data of rows) {
      const sub = this.item(data.offset);
      sub.data = data;
    }

    if (!rows[0]) {
      return this.data?.value; // not an object
    }
  }

  override writer = async (value: any) => {
    await this.reader(); // ensure data is loaded

    if (typeof value !== "object" || value == null) {
      return await this.root.db.query("UPDATE qg_setting SET value = ? WHERE id = ?", [String(value), this.data!.id]);
    }

    const promises = [];
    for (const key in value) {
      promises.push(this.item(key).set(value[key]));
    }
    return Promise.all(promises);
  };

  override remover = async () => {
    await this.reader(); // ensure data is loaded
    for (const sub of this.items()) await sub.remove();
    return await this.root.db.query("DELETE FROM qg_setting WHERE id = ?", [this.data!.id]);
  };
}

export function createSettingItem(db: DB) {
  const root = new SettingItem();
  root.db = db;
  return root;
}
