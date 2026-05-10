/**
 * DbText.ts - Database-backed text/translation storage
 */

// deno-lint-ignore-file no-explicit-any
import { getCtx } from "./RequestContext.ts";
import type { App } from "../server.ts";
import type { Db } from "./Db.ts";

export class DbTextManager {
  #cache: Record<string, DbText> = {};
  #app: App;
  #db;

  constructor(app: App) {
    this.#app = app;
    this.#db = app.db;
  }

  text(id: number | string): DbText {
    const key = String(id);
    return this.#cache[key] ??= new DbText(this, id);
  }

  clearCache(id?: number | string) {
    if (id !== undefined) {
      delete this.#cache[String(id)];
    } else {
      this.#cache = {};
    }
  }

  async generate(): Promise<DbText> {
    const id = parseInt(String(await this.#db.table("text").insert({ lang: this.#app.languages.def })));
    return this.text(id);
  }

  get db(): Db { return this.#db; }
  get app(): App { return this.#app; }
}

export class DbText {
  #manager: DbTextManager;
  #langCache: Map<string, DbTextLang> = new Map();
  public id: number;

  constructor(manager: DbTextManager, id: number | string) {
    this.#manager = manager;
    this.id = parseInt(String(id));
  }

  lang(lang?: string | null): DbTextLang {
    const l: string = lang ?? getCtx()?.lang ?? this.#manager.app.languages.def;
    if (!this.#langCache.has(l)) this.#langCache.set(l, new DbTextLang(this, l));
    return this.#langCache.get(l)!;
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
    const rows = await db.all("SELECT * FROM text WHERE id = ?", [this.id]);
    for (const row of rows) {
      row.id = newText.id;
      const exists = await db.one("SELECT id FROM text WHERE id = ? AND lang = ?", [row.id, row.lang]);
      await (exists ? db.table("text").update(row) : db.table("text").insert(row));
    }
    return newText;
  }

  get manager(): DbTextManager { return this.#manager; }

  async string(): Promise<string | null> {
    const lang = getCtx()?.lang ?? this.#manager.app.languages.def;
    const t = await this.orFallback(lang);
    return t.get();
  }
  toString(): string {
    throw new Error("DbText: toString() not implemented");
  }
}

export class DbTextLang {
  Text: DbText;
  value: string | null = null;
  public lang: string;

  constructor(text: DbText, lang: string) {
    this.Text = text;
    this.lang = lang;
  }

  async get(): Promise<string> {
    if (this.value === null) {
      const db = this.Text.manager.db;
      const value = await db.one("SELECT text FROM text WHERE id = ? AND lang = ?", [this.Text.id, this.lang]);
      this.value = String(value ?? "");
    }
    return this.value!;
  }

  async set(value: any): Promise<void> {
    this.value = null;
    const db = this.Text.manager.db;
    const data = { id: this.Text.id, lang: this.lang, text: value };
    const has = await db.one("SELECT id FROM text WHERE id = ? AND lang = ?", [this.Text.id, this.lang]);
    if (has) await db.table("text").update(data);
    else await db.table("text").insert(data);
  }
  toString() {
    throw new Error("DbTextLang: toString() not implemented");
  }
}
