// deno-lint-ignore-file no-explicit-any
import { getCtx } from "./ctx/Ctx.ts";
import { tableRef, scopeCache } from "./db/dbScope.ts";
import { sql } from "../../../deps.ts";
import type { App } from "./App.ts";
import type { Db } from "./db/Db.ts";

export class DbTextManager {
  #cache: Record<string, DbText> = {};
  #app: App;

  constructor(app: App) {
    this.#app = app;
  }

  get db(): Db { return this.#app.db; }
  get app(): App { return this.#app; }

  text(id: number | string): DbText {
    const cache = scopeCache(this.#cache, "dbTexts", () => ({} as Record<string, DbText>));
    return cache[String(id)] ??= new DbText(this, id);
  }

  clearCache(id?: number | string) {
    const cache = scopeCache(this.#cache, "dbTexts", () => ({} as Record<string, DbText>));
    if (id !== undefined) delete cache[String(id)];
    else for (const k in cache) delete cache[k];
  }

  async generate(): Promise<DbText> {
    const values: Record<string, unknown> = { lang: this.#app.languages.def, text: "" };
    await this.db.table("text").insert(values);
    // insert can be prevented (e.g. read-only history render) → id 0, never NaN
    const id = Number(values.id ?? "0") || 0;
    return this.text(id);
  }
}

export class DbText {
  #manager: DbTextManager;
  #langCache: Map<string, DbTextLang> = new Map();
  id: number;

  constructor(manager: DbTextManager, id: number | string) {
    this.#manager = manager;
    this.id = Number(id);
  }

  get manager(): DbTextManager { return this.#manager; }

  lang(lang: string): DbTextLang {
    return this.#langCache.getOrInsertComputed(lang, () => new DbTextLang(this, lang));
  }

  /** Returns the best available translation, falling back to any other lang */
  async orFallback(lang: string): Promise<DbTextLang> {
    const primary = this.lang(lang);
    if (await primary.get()) return primary;
    for (const l of this.#manager.app.languages.all) {
      if (l === lang) continue;
      const fallback = this.lang(l);
      if (await fallback.get()) return fallback;
    }
    return primary;
  }

  async copy(): Promise<DbText> {
    const db = this.#manager.db;
    const newText = await this.#manager.generate();
    const rows = await db.query`SELECT * FROM text WHERE id = ${this.id}`;
    for (const row of rows) {
      row.id = newText.id;
      const exists = await db.one`SELECT id FROM text WHERE id = ${row.id} AND lang = ${row.lang}`;
      await (exists ? db.table("text").update(row) : db.table("text").insert(row));
    }
    return newText;
  }

  async string(): Promise<string | null> {
    const lang = getCtx().lang;
    const t = await this.orFallback(lang);
    return t.get();
  }

  toString(): string { throw new Error("DbText: toString() not implemented"); }

}

export class DbTextLang {
  text: DbText;
  value: string | null = null;
  lang: string;

  constructor(text: DbText, lang: string) {
    this.text = text;
    this.lang = lang;
  }

  async get(): Promise<string> {
    if (this.value === null) {
      const db = this.text.manager.db;
      const value = await db.one`SELECT text FROM ${sql.id(tableRef("text"))} WHERE id = ${this.text.id} AND lang = ${this.lang}`;
      this.value = String(value ?? "");
    }
    return this.value!;
  }

  async set(value: any): Promise<void> {
    this.value = null;
    const db = this.text.manager.db;
    const data = { id: this.text.id, lang: this.lang, text: value };
    const has = await db.one`SELECT id FROM text WHERE id = ${this.text.id} AND lang = ${this.lang}`;
    if (has) await db.table("text").update(data);
    else await db.table("text").insert(data);
  }

  toString() { throw new Error("DbTextLang: toString() not implemented"); }

}
