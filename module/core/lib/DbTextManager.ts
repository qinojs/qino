// deno-lint-ignore-file no-explicit-any
import { getCtx } from "./ctx/Ctx.ts";
import { tableRef, scopeCache } from "./db/dbScope.ts";
import { sql } from "../deps.ts";

import type { App } from "./App.ts";
import type { Db } from "./db/Db.ts";

export class DbTextManager {
  #cache = new Map<string, DbText>();
  #app: App;

  constructor(app: App) {
    this.#app = app;
  }

  get db(): Db { return this.#app.db; }
  get app(): App { return this.#app; }

  #texts(): Map<string, DbText> {
    return scopeCache<Map<string, DbText>>(this.#cache, "dbTexts", () => new Map());
  }

  text(id: number | string): DbText {
    return this.#texts().getOrInsertComputed(String(id), () => new DbText(this, id));
  }

  clearCache(id?: number | string) {
    const cache = this.#texts();
    if (id !== undefined) cache.delete(String(id));
    else cache.clear();
  }

  async generate(): Promise<DbText> {
    const values: Record<string, unknown> = {};
    await this.db.table("text").insert(values);
    // insert can be prevented (e.g. read-only history render) → id 0, never NaN
    return this.text(Number(values.id) || 0);
  }
}

export class DbText {
  #manager: DbTextManager;
  #langCache = new Map<string, DbTextLang>();
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
    for (const row of await db.query`SELECT * FROM ${sql.id(tableRef("text_lang"))} WHERE text_id = ${this.id}`) {
      await db.table("text_lang").insert({ ...row, text_id: newText.id });
    }
    return newText;
  }

  async string(): Promise<string | null> {
    const lang = getCtx().lang;
    return (await this.orFallback(lang)).get();
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
      const value = await db.one`SELECT text FROM ${sql.id(tableRef("text_lang"))} WHERE text_id = ${this.text.id} AND lang = ${this.lang}`;
      this.value = String(value ?? "");
    }
    return this.value!;
  }

  async set(value: any): Promise<void> {
    this.value = null;
    await this.text.manager.db.table("text_lang").ensure({ text_id: this.text.id, lang: this.lang, text: value });
  }

  toString() { throw new Error("DbTextLang: toString() not implemented"); }

}
