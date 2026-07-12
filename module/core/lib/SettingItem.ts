import { Item, sql } from "../../../deps.ts";
import type { Db } from "./db/Db.ts";

class SettingItem extends Item<SettingItem> {
  data: Record<string, unknown> | undefined;
  db!: Db;

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
      const result = await this.root.db.exec`INSERT INTO qg_setting (basis, ${sql.id("offset")}, value) VALUES (${parentId}, ${offset}, '')`;
      this.data = await this.root.db.row`SELECT * FROM qg_setting WHERE id = ${result.insertId}`;
    }

    // fetch children
    const id = this.data?.id ?? 0;
    const rows = await this.root.db.query`SELECT * FROM qg_setting WHERE basis = ${id} ORDER BY ${sql.id("offset")}`;
    for (const data of rows) {
      const sub = this.item(data.offset);
      sub.data = data;
    }

    if (!rows[0]) {
      return this.data?.value; // not an object
    }
  }

  override writer = async (value: unknown) => {
    await this.reader(); // ensure data is loaded

    if (typeof value !== "object" || value == null) {
      return this.root.db.query`UPDATE qg_setting SET value = ${String(value)} WHERE id = ${this.data!.id}`;
    }

    const promises = [];
    for (const key in value) {
      promises.push(this.item(key).set((value as Record<string, unknown>)[key]));
    }
    return Promise.all(promises);
  };

  override remover = async () => {
    await this.reader(); // ensure data is loaded
    for (const sub of this.items()) await sub.remove();
    return this.root.db.query`DELETE FROM qg_setting WHERE id = ${this.data!.id}`;
  };
}

export function createSettingItem(db: Db) {
  const root = new SettingItem();
  root.db = db;
  return root;
}
