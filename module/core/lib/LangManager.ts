import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import { requestStorage } from "./ctx/Ctx.ts";
import { sql } from "../deps.ts";
import { fill, tag } from "../pub/js/tag.js";

import type { App } from "./App.ts";
import type { Ctx } from "./ctx/Ctx.ts";
import type { Db } from "./db/Db.ts";

type Scope = { ns?: string; lang?: string };
/** t`…`, t.in(ns)`…`, t.with(ns or { ns, lang }, fn) — as in the browser (core/pub/js/t.js). */
export type T = ReturnType<typeof tag<Promise<string>>>;

export const md5 = (text: string): string => createHash("md5").update(text).digest("hex");

export class LangManager {

  #app: App;
  #langs = ["en"];   // the site's languages by priority, first = default
  #indexes = new Map<string, Promise<Map<string, string>>>();
  #langOf = new WeakMap<Ctx, Record<string, string>>(); // per request: the language of each namespace
  #recorded = new Set<string>(); // "ns\noriginal" added by #record, so another language's index does not add it again
  #scope = new AsyncLocalStorage<Scope>();

  /** Called with each text t`` looks up — the dev module counts them (smalltext.count). */
  onUse?: (ns: string, original: string) => void;

  t: T;

  constructor(app: App) {
    this.#app = app;
    this.t = tag((ns, original, values, lang) => this.#translate(ns, original, values, lang),
      { get: () => this.#scope.getStore(), run: (scope: Scope, fn: () => unknown) => this.#scope.run(scope, fn) });
  }

  get def(): string { return this.#langs[0]; }
  get all(): string[] { return [...this.#langs]; }

  /** The site's languages by priority, "de, en, fr" or a list; the first is the default. */
  setLangs(langs: string | string[]) {
    const list = (typeof langs === "string" ? langs.split(",") : langs).map((l) => l.trim().toLowerCase()).filter(Boolean);
    this.#langs = list.length ? list : ["en"];
    this.clear();
  }

  // Initialises language per request (like L.init)
  async initCtx(ctx: Ctx): Promise<void> {
    const usr = ctx.user;

    const stored = String(usr ? usr.lang ?? "" : ctx.sess.data.core.lang() ?? "");
    ctx.langUsr = stored;

    const urlLang = ctx.req.query.lang;
    if (urlLang) ctx.langUsr = urlLang;
    else {
      const match = ctx.req.appPath?.match(/^([a-z]{2})([\/?]|$)/);
      if (match) ctx.langUsr = match[1];
    }

    if (!this.#langs.includes(ctx.langUsr)) ctx.langUsr = "";
    ctx.langUsr ||= this.#fromBrowser(ctx);

    // background write, only when the language changed
    if (ctx.langUsr !== stored) usr ? usr.$set({ lang: ctx.langUsr }).catch(() => {}) : ctx.sess.data.core.lang(ctx.langUsr);

    ctx.lang = ctx.langUsr;
  }

  // Determine language from the browser Accept-Language header
  #fromBrowser(ctx: Ctx) {
    const acceptLang = ctx.req.header("accept-language");
    if (!acceptLang) return this.def;
    const accepted = acceptLang.split(/,\s*/);
    let currentLang = this.def;
    let currentQ = 0;
    for (const aLang of accepted) {
      const match = aLang.match(/^([a-z]{1,8}(?:-[a-z]{1,8})*)(?:;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?$/i);
      if (!match) continue;
      const langCode = match[1].split("-");
      const langQuality = parseFloat(match[2] ?? "1");
      while (langCode.length) {
        const code = langCode.join("-").toLowerCase();
        if (this.#langs.includes(code)) {
          if (langQuality > currentQ) {
            currentLang = code;
            currentQ = langQuality;
          }
          break;
        }
        langCode.pop();
      }
    }
    return currentLang;
  }

  /** Drop the cached indexes (call after direct writes to `smalltext` / `smalltext_lang`). */
  clear() { this.#indexes.clear(); }

  /** The language of `ns`'s texts: the scope's, else the user's for the namespace (core.lang_ns), else the
   *  request's — outside a request (jobs, the outbox) the site's default. Read once per request and namespace. */
  #lang(ns: string, ctx: Ctx | undefined, lang?: string): string {
    if (lang && this.#langs.includes(lang)) return lang;
    if (!ctx) return this.def;
    if (!ns) return ctx.lang;
    const of = this.#langOf.getOrInsertComputed(ctx, () => ({}));
    if (!(ns in of)) {
      let own = "";
      try { own = String(ctx.settings.core.lang_ns[ns]?.() ?? ""); } catch { /* a context without settings (no request): no user choice */ }
      of[ns] = this.#langs.includes(own) ? own : ctx.lang;
    }
    return of[ns];
  }

  /**
   * Every text `ns` and the global namespace know, each as found first: in `lang`, then in the site's other
   * languages by priority, each from `ns` before the global ones. English ends the search — the originals are
   * English. Known but not translated: "". One query per (ns, lang), the first time a lookup needs it.
   */
  #index(ns: string, lang: string): Promise<Map<string, string>> {
    return this.#indexes.getOrInsertComputed(`${ns}|${lang}`, async () => {
      const order = [lang, ...this.#langs.filter((l) => l !== lang)];
      const chain = order.includes("en") ? order.slice(0, order.indexOf("en") + 1) : order;
      const rows = await this.#app.db.query`SELECT s.original, s.namespace, l.lang, l.text FROM smalltext s
        LEFT JOIN smalltext_lang l ON l.hash = s.hash AND l.namespace = s.namespace AND l.lang IN (${sql.join(chain.map((l) => sql`${l}`))})
        WHERE s.namespace IN (${ns}, '')`;
      const index = new Map<string, string>(), rank = new Map<string, number>();
      for (const { original, namespace, lang: l, text } of rows) {
        if (!index.has(original)) index.set(original, "");
        if (!text) continue;
        const r = chain.indexOf(l) * 2 + (namespace === ns ? 0 : 1);
        if (r < (rank.get(original) ?? Infinity)) rank.set(original, r), index.set(original, text);
      }
      return index;
    });
  }

  /** A text no namespace in reach knows yet, so it can be translated: added to `ns`, once — also when the
   *  index of another language meets it later — in the background. */
  #record(index: Map<string, string>, ns: string, original: string) {
    index.set(original, "");
    if (this.#recorded.has(ns + "\n" + original)) return;
    this.#recorded.add(ns + "\n" + original);
    this.#app.db.table("smalltext").insert({ namespace: ns, hash: md5(original), original }).catch(() => {});
  }

  async #translate(ns: string, original: string, values: unknown[], scopeLang?: string): Promise<string> {
    const ctx = requestStorage.getStore();
    const lang = this.#lang(ns, ctx, scopeLang);
    const index = await this.#index(ns, lang);
    let text = index.get(original);
    if (text === undefined) this.#record(index, ns, original);
    this.onUse?.(ns, original);
    if (!text) text = ctx?.dev && lang !== "en" ? `*${original}*` : original;
    if (!values.length) return text;
    // most values are plain: awaiting them all would cost a promise per call
    return fill(text, values.some((v) => typeof (v as PromiseLike<unknown>)?.then === "function") ? await Promise.all(values) : values);
  }

  /** `texts` of `ns` as t`` gives them, for the browser (api core/t). Only "" and loaded modules are
   *  namespaces here, so a caller cannot grow the indexes; new texts are recorded in dev mode only. */
  async lookup(texts: string[], ns: string, ctx: Ctx): Promise<Record<string, string>> {
    if (ns && !this.#app.modules.get(ns)) ns = "";
    const index = await this.#index(ns, this.#lang(ns, ctx));
    // keys come from the caller: a plain object would swallow `__proto__` and inherit `toString`
    const out: Record<string, string> = Object.create(null);
    for (const original of texts) {
      const text = index.get(original);
      if (text === undefined && ctx.dev) this.#record(index, ns, original);
      out[original] = text || original;
    }
    return out;
  }

  /** All translations, every language: { ns: { lang: { original: text } } }. */
  async export(): Promise<Record<string, Record<string, Record<string, string>>>> {
    const out: Record<string, Record<string, Record<string, string>>> = {};
    for (const { namespace, lang, original, text } of await this.#app.db.query`SELECT s.namespace, l.lang, s.original, l.text
      FROM smalltext s JOIN smalltext_lang l ON l.hash = s.hash AND l.namespace = s.namespace ORDER BY s.original`) {
      ((out[namespace] ??= {})[lang] ??= {})[original] = text;
    }
    return out;
  }

  /** Seeds `ns` from a locale file ({ original: text }), in any language. Fills only what is missing, never
   *  overwrites; nothing new: one read, no write. */
  async import(lang: string, ns: string, json: string | Record<string, string>): Promise<void> {
    const entries = Object.entries<string>(typeof json === "string" ? JSON.parse(json) : json).filter(([, text]) => text);
    if (!entries.length) return;
    const db = this.#app.db;
    const known = new Map<string, boolean>(); // by original: md5 only for what is missing, it runs on every boot
    for (const { original, text } of await db.query`SELECT s.original, l.text FROM smalltext s
      LEFT JOIN smalltext_lang l ON l.hash = s.hash AND l.namespace = s.namespace AND l.lang = ${lang} WHERE s.namespace = ${ns}`) {
      known.set(original, !!text);
    }
    const missing = entries.filter(([original]) => !known.get(original)).map(([original, text]) => ({ hash: md5(original), original, text }));
    if (!missing.length) return;
    await db.transaction(async () => {
      for (const { hash, original, text } of missing) {
        if (!known.has(original)) await db.table("smalltext").insert({ namespace: ns, hash, original });
        await db.table("smalltext_lang").insert({ hash, namespace: ns, lang, text });
      }
    });
    this.clear(); // imported texts must be visible on the next lookup
  }

}

/** PHP's smalltext had a column per language: its translations move to smalltext_lang, the columns go. Once;
 *  without such columns it does nothing. */
export async function migrateSmalltext(db: Db): Promise<void> {
  const langs = [...db.table("smalltext").fields?.keys() ?? []].filter((c) => /^[a-z]{2,3}$/.test(c));
  if (!langs.length) return;
  await db.transaction(async () => {
    for (const l of langs) {
      await db.exec`INSERT INTO smalltext_lang (hash, namespace, lang, text)
        SELECT s.hash, s.namespace, ${l}, ${sql.id(l)} FROM smalltext s WHERE COALESCE(${sql.id(l)}, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM smalltext_lang x WHERE x.hash = s.hash AND x.namespace = s.namespace AND x.lang = ${l})`;
      await db.exec`ALTER TABLE smalltext DROP COLUMN ${sql.id(l)}`;
    }
  });
  await db.loadTables();
}
