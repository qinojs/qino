import { createHash } from "node:crypto";

import { getCtx } from "./ctx/Ctx.ts";
import { sql } from "../deps.ts";

import type { App } from "./App.ts";
import type { Ctx } from "./ctx/Ctx.ts";

export class LangManager {

  #app: App;
  #langs: string[] = [];   // all available languages, first = default
  #txtsCache = new Map<string, Promise<Record<string, string>>>();

  constructor(app: App) {
    this.#app = app;
    this.t = this.t.bind(this);
  }

  get def(): string { return this.#langs[0] ?? "en"; }
  get all(): string[] { return [...this.#langs]; }

  setLangs(langs: string[]) {
    this.#langs = langs.map(l=>l.trim().toLowerCase()).filter(Boolean);
    if (!this.#langs.length) this.#langs = ["en"];
  }

  // Initialises language per request (like L.init)
  async initCtx(ctx: Ctx): Promise<void> {
    const usr = ctx.user;

    const stored = String(usr ? usr.lang ?? "" : ctx.sess.data.core.lang() ?? "");
    ctx.langUsr = stored;

    const urlLang = ctx.req.query.lang;
    if (urlLang) ctx.langUsr = urlLang;
    else {
      const match = ctx.req.appPath?.match(/^([a-z][a-z])(\/|$|\?)/);
      if (match) ctx.langUsr = match[1];
    }

    if (!this.#langs.includes(ctx.langUsr)) ctx.langUsr = "";
    ctx.langUsr ||= this.#fromBrowser(ctx);

    // background write, the request does not wait for it — and only when the language actually changed
    if (ctx.langUsr !== stored) usr ? usr.$set({ lang: ctx.langUsr }) : ctx.sess.data.core.lang(ctx.langUsr);

    ctx.lang = ctx.langUsr;
    ctx.langNs ??= "";
    ctx.langNsPath ??= [];
  }

  nsStart(ns: string, ctx?: Ctx) {
    const c = ctx ?? getCtx();
    c.langNsPath.push(c.langNs);
    c.langNs = ns;
    const nsLang = String(c.settings.core.lang_ns[ns]() ?? "");
    c.lang = (nsLang && this.#langs.includes(nsLang)) ? nsLang : c.langUsr;
  }

  nsStop(ctx?: Ctx) {
    const c = ctx ?? getCtx();
    c.langNs = c.langNsPath.pop() ?? "";
    const nsLang = String(c.settings.core.lang_ns[c.langNs]?.() ?? "");
    c.lang = (nsLang && this.#langs.includes(nsLang)) ? nsLang : c.langUsr;
  }

  // Determine language from the browser Accept-Language header
  #fromBrowser(ctx: Ctx) {
    const acceptLang = ctx.req.header("accept-language");
    if (!acceptLang) return this.def;
    const accepted = acceptLang.split(/,\s*/);
    let currentLang = this.def;
    let currentQ = 0;
    for (const aLang of accepted) {
      const match = aLang.match(/^([a-z]{1,8}(?:-[a-z]{1,8})*)(?:;\s*q=(0(?:\.[0-9]{1,3})?|1(?:\.0{1,3})?))?$/i);
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

  // Drop the cached smalltext indexes (call after direct writes to `smalltext`)
  clear() { this.#txtsCache.clear(); }

  #getTxts(ns: string, l: string): Promise<Record<string, string>> {
    // Cache the promise, not the resolved value: parallel lookups (html.async) share one query instead of stampeding.
    return this.#txtsCache.getOrInsertComputed(`${l}::${ns}`, () => this.#app.db.indexCol<string>`
      SELECT hash, ${sql.id(l)} as txt FROM smalltext WHERE namespace = ${ns}`);
  }

  async #getTxt(string: string, ctx: Ctx): Promise<string> {
    const hash = createHash("md5").update(string).digest("hex");
    const ns = ctx.langNs;
    const l = ctx.lang;
    const txts = await this.#getTxts(ns, l);
    if (!(hash in txts)) {
      txts[hash] = ""; // claim it before awaiting: the same new string, twice in one render, must insert once
      await this.#app.db.table('smalltext').insert({ namespace: ns, hash, original: string }).catch(() => {});
    }
    const translated = txts[hash] || string;
    if (ctx.dev && !txts[hash]) return `*${string}*`;
    if (await this.#app.settings.core.smalltext.counter) {
      this.#app.db.exec`UPDATE smalltext SET count = count+1 WHERE hash = ${hash} AND namespace = ${ns}`
        .catch(() => {}); // fire-and-forget, already logged by Db
    }
    return translated;
  }

  // Shortcut: translate text (uses the current ctx automatically)
  async t(strings: TemplateStringsArray, ...values: unknown[]): Promise<string> {
    const ctx = getCtx();
    const original = strings.reduce((acc, str, i) => acc + str + (i < strings.length - 1 ? `{${i}}` : ""), "");
    let result = await this.#getTxt(original, ctx);
    const resolved = await Promise.all(values);
    for (let i = 0; i < resolved.length; i++)
      result = result.replaceAll(`{${i}}`, String(resolved[i] ?? ""));
    return result;
  }

  // Export all non-empty translations, grouped by namespace and language: { ns: { lang: { original: txt } } }
  async export(): Promise<Record<string, Record<string, Record<string, string>>>> {
    const langs = this.#langs;
    const rows = await this.#app.db.query`SELECT namespace, original, ${sql.join(langs.map(l => sql.id(l)))} FROM smalltext ORDER BY original`;
    const out: Record<string, Record<string, Record<string, string>>> = {};
    for (const row of rows) {
      for (const l of langs) {
        const txt = row[l];
        if (!txt) continue;
        ((out[row.namespace] ??= {})[l] ??= {})[row.original] = txt;
      }
    }
    return out;
  }


  // Import translations for one namespace from { original: txt }; only fills empty entries, never overwrites
  async import(lang: string, ns: string, json: string | Record<string, string>): Promise<void> {
    const txts = typeof json === "string" ? JSON.parse(json) : json;
    const db = this.#app.db;
    await db.transaction(async () => {
      for (const [original, txt] of Object.entries(txts)) {
        if (!txt) continue;
        const hash = createHash("md5").update(original).digest("hex");
        const exists = await db.row`SELECT hash FROM smalltext WHERE hash = ${hash} AND namespace = ${ns}`;
        if (!exists) await db.table("smalltext").insert({ namespace: ns, hash, original });
        await db.exec`UPDATE smalltext SET ${sql.id(lang)} = ${txt} WHERE hash = ${hash} AND namespace = ${ns} AND COALESCE(${sql.id(lang)}, '') = ''`;
      }
    });
    this.clear(); // imported rows must be visible on the next lookup
  }

}
