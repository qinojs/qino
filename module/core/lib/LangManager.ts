import { getCtx, type RequestContext } from "./RequestContext.ts";
import { createHash } from "node:crypto";
import { sql } from "../../../deps.ts";
import type { App } from "./App.ts";

export class LangManager {

  #app: App;
  #langs: string[] = [];   // all available languages, first = default
  #txtsCache: Record<string, Record<string, string>> = {};

  constructor(app: App) {
    this.#app = app;
    this.t = this.t.bind(this);
  }

  get def(): string { return this.#langs[0] ?? "en"; }
  get all(): string[] { return [...this.#langs]; }

  setLangs(langs: string[]): void {
    this.#langs = langs.map(l=>l.trim().toLowerCase()).filter(Boolean);
    if (!this.#langs.length) this.#langs = ["en"];
  }

  // Initialises language per request (like L.init)
  async initCtx(ctx: RequestContext): Promise<void> {
    const usr = ctx.user;

    ctx.langUsr = usr ? (await usr.get("lang") ?? "") : ctx.sess.data.core.lang() ?? "";

    const urlLang = ctx.get.lang ?? ctx.get.changeLanguage; // changeLanguage: frozen PHP-era alias
    if (urlLang) {
      ctx.langUsr = urlLang;
    } else {
      const match = ctx.appRequestPath?.match(/^([a-z][a-z])(\/|$|\?)/);
      if (match) ctx.langUsr = match[1];
    }

    if (!this.#langs.includes(ctx.langUsr)) ctx.langUsr = "";
    ctx.langUsr ||= this.#fromBrowser(ctx);

    if (usr) {
      usr.set("lang", ctx.langUsr);
    } else {
      ctx.sess.data.core.lang(ctx.langUsr);
    }

    ctx.lang = ctx.langUsr;
    ctx.langNs ??= "";
    ctx.langNsPath ??= [];
  }

  nsStart(ns: string, ctx?: RequestContext): void {
    const c = ctx ?? getCtx();
    c.langNsPath.push(c.langNs);
    c.langNs = ns;
    const nsLang = String(c.settings.core.lang_ns[ns]() ?? "");
    c.lang = (nsLang && this.#langs.includes(nsLang)) ? nsLang : c.langUsr;
  }

  nsStop(ctx?: RequestContext): void {
    const c = ctx ?? getCtx();
    c.langNs = c.langNsPath.pop() ?? "";
    const nsLang = String(c.settings.core.lang_ns[c.langNs]?.() ?? "");
    c.lang = (nsLang && this.#langs.includes(nsLang)) ? nsLang : c.langUsr;
  }

  // Determine language from the browser Accept-Language header
  #fromBrowser(ctx: RequestContext): string {
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

  async #getTxts(ns: string, l: string): Promise<Record<string, string>> {
    const key = `${l}::${ns}`;
    if (!this.#txtsCache[key]) {
      this.#txtsCache[key] = await this.#app.db.indexCol`SELECT hash, ${sql.id(l)} as txt FROM smalltext WHERE namespace = ${ns}` as Record<string, string>;
    }
    return this.#txtsCache[key];
  }

  async #getTxt(string: string, ctx: RequestContext): Promise<string> {
    const hash = createHash("md5").update(string).digest("hex");
    const ns = ctx.langNs;
    const l = ctx.lang;
    const txts = await this.#getTxts(ns, l);
    if (!(hash in txts)) {
      await this.#app.db.table('smalltext').insert({ namespace: ns, hash, original: string });
      txts[hash] = "";
    }
    const translated = txts[hash] || string;
    if (ctx.dev && !txts[hash]) return `*${string}*`;
    if (await this.#app.settings.core.smalltext.counter) {
      this.#app.db.query`UPDATE smalltext SET count = count+1 WHERE hash = ${hash} AND namespace = ${ns}`
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
    const txts: Record<string, string> = typeof json === "string" ? JSON.parse(json) : json;
    const db = this.#app.db;
    for (const [original, txt] of Object.entries(txts)) {
      if (!txt) continue;
      const hash = createHash("md5").update(original).digest("hex");
      const exists = await db.row`SELECT hash FROM smalltext WHERE hash = ${hash} AND namespace = ${ns}`;
      if (!exists) await db.table("smalltext").insert({ namespace: ns, hash, original });
      await db.query`UPDATE smalltext SET ${sql.id(lang)} = ${txt} WHERE hash = ${hash} AND namespace = ${ns} AND COALESCE(${sql.id(lang)}, '') = ''`;
    }
    delete this.#txtsCache[`${lang}::${ns}`]; // imported rows must be visible on the next lookup
  }

}
