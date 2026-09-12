import { s, Access, ApiError, sql } from "@qino/qino";
import { cms, sanitizeHtml } from "@qino/qino/cms";

import type { ApiTree, Params, Ctx } from "@qino/qino";

class CmsTextService {
  #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  get ctx(): Ctx { return this.#ctx; }
  get #app() { return this.#ctx.app; }

  /** Only configured language codes may reach the text table. "auto"/"clean" are internal source modes. */
  #lang(code: string, ...modes: string[]): string {
    if (modes.includes(code) || this.#app.languages.all.includes(code)) return code;
    throw new ApiError(400, `Unknown language "${code}"`);
  }

  async textAccess(textId: number): Promise<this | undefined> {
    const pid = await this.#app.api.cms["node-id-from-txt-id"].get({ id: textId })
      .then(r => (r as { id: number } | undefined)?.id).catch(() => undefined);
    if (!pid) return;
    const node = await cms(this.#app).node(pid);
    if (await node.access() >= 2) return this;
  }

  async get(textId: number) {
    if (!await this.textAccess(textId)) return false;
    const results = [];
    for (const lang of this.#app.languages.all) {
      const text = await this.#app.db.one`SELECT text FROM text WHERE id = ${textId} AND lang = ${lang}`;
      results.push({
        lang,
        text: !text ? false : sanitizeHtml(String(text)),
      });
    }
    return results;
  }

  async translate(textId: number, targetLang: string, sourceLang: string) {
    targetLang = this.#lang(targetLang);
    sourceLang = this.#lang(sourceLang);
    if (!await this.textAccess(textId)) throw new ApiError(403, "No access to this text");
    const db = this.#app.db;
    const input = String(await db.one`SELECT text FROM text WHERE id = ${textId} AND lang = ${sourceLang}` ?? "");
    if (!input.trim()) throw new ApiError(400, "Source text is empty");
    let output = await this.transl(input, targetLang, sourceLang);
    if (!output) throw new ApiError(502, "Translation service returned nothing");

    if (/^[A-Z]/.test(input)) output = output.charAt(0).toUpperCase() + output.slice(1);

    await db.table("text").ensure({ id: textId, lang: targetLang, text: output });
    return true;
  }

  async translatePageAllLangs(pid: number, ifNeeded: boolean, subpages: boolean): Promise<{ count: number; fail: number }> {
    const stats = { count: 0, fail: 0 };
    for (const lang of this.#app.languages.all) {
      const result = await this.translatePage(pid, lang, "auto", ifNeeded, subpages);
      stats.count += result.count;
      stats.fail += result.fail;
    }
    return stats;
  }

  async translatePage(
    pid: number,
    targetLang: string,
    sourceLang = "auto",
    ifNeeded = true,
    subpages = false
  ): Promise<{ count: number; fail: number }> {
    targetLang = this.#lang(targetLang);
    sourceLang = this.#lang(sourceLang, "auto", "clean");
    const stats = { count: 0, fail: 0 };
    const done = await this.translateCont(pid, targetLang, sourceLang, ifNeeded);
    if (done === false) ++stats.fail;
    else stats.count += done;
    const node = await cms(this.#app).node(pid);
    const children = await node.children({ type: subpages ? "*" : "c" });
    for (const child of children.values()) {
      const result = await this.translatePage(child.id, targetLang, sourceLang, ifNeeded, subpages);
      stats.count += result.count;
      stats.fail += result.fail;
    }
    return stats;
  }

  async translateCont(pid: number, targetLang: string, sourceLang = "auto", ifNeeded = true): Promise<number | false> {
    const node = await cms(this.#app).node(pid);
    if (await node.access() < 2) return false;
    let count = 0;
    const title = await node.title();
    count += await this.translateText(title.id, targetLang, sourceLang, ifNeeded);
    for (const text of (await node.texts()).values()) {
      count += await this.translateText(text.id, targetLang, sourceLang, ifNeeded);
    }
    return count;
  }

  async translateText(textId: number, targetLang: string, sourceLang = "auto", ifNeeded = true): Promise<number> {
    const textEntry = this.#app.dbTexts.text(textId);

    if (ifNeeded && sourceLang !== "clean" && (await textEntry.lang(targetLang).get()).trim()) return 0;

    if (sourceLang === "auto") {
      sourceLang = "";
      for (const lang of this.#app.languages.all) {
        if (lang === targetLang) continue;
        const sourceText = await textEntry.lang(lang).get();
        if (sourceText.trim() === "") continue;
        sourceLang = lang;
      }
    }
    if (!sourceLang) return 0;

    let text: string;
    if (sourceLang === "clean") text = "";
    else {
      const sourceText = await textEntry.lang(sourceLang).get();
      const translated = await this.transl(sourceText, targetLang, sourceLang);
      if (!translated) return 0;
      text = translated;
    }
    await textEntry.lang(targetLang).set(text);
    return 1;
  }

  async transl(text: string, targetLang: string, sourceLang: string): Promise<string | false> {
    if (sourceLang && sourceLang === targetLang) return text; // nothing to translate
    const service = String(await this.#app.settings["cms.text"]["translation service"] ?? "");
    if (service === "google") return this.googleTranslate(text, sourceLang, targetLang);
    if (service === "deepl") return this.deeplTranslate(text, sourceLang, targetLang);
    throw new ApiError(400, "No translation service configured");
  }

  async deeplTranslate(text: string, sourceLang: string, targetLang: string): Promise<string | false> {
    console.warn("deprecated? deepl used");
    const settings = this.#app.settings["cms.text"];
    const params = new URLSearchParams({
      text,
      source_lang: sourceLang,
      target_lang: targetLang,
      tag_handling: "xml",
      split_sentences: "1",
      preserve_formatting: "0",
      auth_key: String(await this.#app.settings.core.keys["api.deepl.com"] ?? ""),
    });
    const resp = await fetch("https://api.deepl.com/v2/translate", {
      method: "POST",
      body: params,
    }).then(r => r.json()) as { translations?: { text: string }[] };
    const translation = resp?.translations?.[0]?.text ?? false;
    if (translation) {
      const prev = Number(await settings["translate char count"] ?? "0");
      settings["translate char count"](prev + text.length);
    }
    return translation;
  }

  async googleTranslate(text: string, sourceLang: string, targetLang: string): Promise<string | false> {
    const settings = this.#app.settings["cms.text"];
    const key = String(await this.#app.settings.core.keys["googleapis.com"] ?? "");
    const params = new URLSearchParams({
      q: text,
      target: targetLang,
      format: "html",
      source: sourceLang,
      model: "nmt",
      key,
    });
    const resp = await fetch("https://translation.googleapis.com/language/translate/v2?" + params);
    if (!resp.ok) { console.error("[googleTranslate]", resp.status, await resp.text()); throw new ApiError(502, "Translation service request failed"); }
    const result = await resp.json() as { data?: { translations?: { translatedText: string }[] } };
    const translation = result?.data?.translations?.[0]?.translatedText ?? false;
    if (translation) {
      const prev = Number(await settings["translate char count"] ?? "0");
      settings["translate char count"](prev + text.length);
    }
    return translation;
  }

  async history(textId: number, lang: string) {
    if (!await this.textAccess(textId)) return false;
    const SPACE = 0; // cms_vers::$space — cms.versions not ported yet
    const rows = await this.#app.db.query<{ text: string | null; log_id: number; log_time: number; email: string | null }>`
      SELECT text.text, log.id as log_id, log.time as log_time, usr.username as email
      FROM _vers_text text
      LEFT JOIN log ON text._vers_log = log.id
      LEFT JOIN sess ON log.sess_id = sess.id
      LEFT JOIN usr ON sess.usr_id = usr.id
      WHERE
        text._vers_log <> 0
        AND text.id = ${textId}
        AND text.lang = ${lang}
        AND text._vers_space = ${SPACE}
      ORDER BY text._vers_log DESC
      LIMIT 100`;
    for (const row of rows) if (row.text) row.text = sanitizeHtml(row.text); // dialog renders it via innerHTML
    return rows;
  }

  async isTranslated(textIds: number | number[], lang = this.ctx.lang) {
    const ids = (Array.isArray(textIds) ? textIds : [textIds]).map(Number).filter(Number.isFinite);
    if (!ids.length) return Array.isArray(textIds) ? {} : false;
    const rows = await this.#app.db.query<{ id: number; text: string | null }>`SELECT id, text FROM text WHERE ${sql.in("id", ids)} AND lang = ${lang}`;
    const map: Record<number, boolean> = {};
    for (const row of rows) map[row.id] = !!row.text;
    if (!Array.isArray(textIds)) return map[ids[0]] ?? false;
    return Object.fromEntries(ids.map(id => [id, map[id] ?? false]));
  }
}

export const service = (ctx: Ctx): CmsTextService => new CmsTextService(ctx);

export const api: ApiTree = {
  text: {
    "are-translated": {
      get: {
        description: "Batch-check if multiple texts are translated in a language",
        // No per-id access check: authenticated users can probe existence/translated-status of foreign
        // text ids (metadata only, no content). Accepted trade-off; rate-limit later if needed.
        access: Access.USER,
        query: s.object({
          ids: s.string().describe("Underscore-separated text IDs"),
          lang: s.optional(s.string()).describe("Language code. Default: current language"),
        }),
        execute: ({ ids, lang }: Params, ctx: Ctx) => service(ctx).isTranslated(String(ids).split("_").map(Number), lang == null ? undefined : String(lang)),
      },
    },
    ":text": {
      paramSchema: s.number().describe("Text-ID"),
      get: {
        description: "Read text in all languages",
        access: Access.USER, // fine-grained check via textAccess() in execute
        execute: ({ text }: Params, ctx: Ctx) => service(ctx).get(Number(text)),
      },
      translate: {
        post: {
          description: "Translate text into a target language",
          access: Access.USER,
          input: s.object({
            targetLang: s.string().describe("Target language code, e.g. \"en\""),
            sourceLang: s.string().describe("Source language code, e.g. \"de\""),
          }),
          execute: ({ text, targetLang, sourceLang }: Params, ctx: Ctx) =>
            service(ctx).translate(Number(text), String(targetLang), String(sourceLang)),
        },
      },
      history: {
        get: {
          description: "Read text history for a language",
          access: Access.USER,
          input: s.object({ lang: s.string().describe("Language code, e.g. \"de\"") }),
          execute: ({ text, lang }: Params, ctx: Ctx) => service(ctx).history(Number(text), String(lang)),
        },
      },
    },
  },
  page: {
    ":page": {
      paramSchema: s.number().describe("Node-ID"),
      translate: {
        post: {
          description: "Translate all texts of a page/content into a target language",
          access: Access.USER,
          input: s.object({
            targetLang: s.string().describe("Target language code, e.g. \"en\""),
            sourceLang: s.optional(s.string()).describe("Source language code. Default: auto-detect"),
            ifNeeded: s.optional(s.boolean()).describe("Skip already translated texts"),
            subpages: s.optional(s.boolean()).describe("Include sub-pages"),
          }),
          execute: ({ page, targetLang, sourceLang, ifNeeded, subpages }: Params, ctx: Ctx) =>
            service(ctx).translatePage(Number(page), String(targetLang), String(sourceLang ?? "auto"), Boolean(ifNeeded ?? true), Boolean(subpages ?? false)),
        },
      },
      "translate-all-langs": {
        post: {
          description: "Translate a page/content into all languages",
          access: Access.USER,
          input: s.object({
            ifNeeded: s.optional(s.boolean()).describe("Skip already translated texts"),
            subpages: s.optional(s.boolean()).describe("Include sub-pages"),
          }),
          execute: ({ page, ifNeeded, subpages }: Params, ctx: Ctx) =>
            service(ctx).translatePageAllLangs(Number(page), Boolean(ifNeeded ?? true), Boolean(subpages ?? false)),
        },
      },
    },
  },
};
