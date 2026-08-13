// deno-lint-ignore-file no-explicit-any
import { s, Access, ApiError, sql } from "@qino/qino";
import { cms, sanitizeHtml } from "@qino/qino/cms";

import type { ApiTree, Ctx } from "@qino/qino";

class CmsTextService {

    #ctx: Ctx;

    constructor(ctx: Ctx) {
        this.#ctx = ctx;
    }

    get ctx(): Ctx { return this.#ctx; }
    get #app() { return this.#ctx.app; }

    async textAccess(text_id: any): Promise<boolean> {
        text_id = Number(text_id);
        const pid = await this.#app.api.cms["node-id-from-txt-id"].get({ id: text_id }).then((r: any) => r?.id ?? null).catch(() => null);
        if (!pid) return false;
        const node = await cms(this.#app).node(pid);
        return (await node.access()) >= 2;
    }

    async get(txt_id: any): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) return false;
        const results = [];
        for (const lang of this.#app.languages.all) {
            const text = await this.#app.db.one`SELECT text FROM text WHERE id = ${txt_id} AND lang = ${lang}`;
            results.push({
                lang,
                text: !text ? false : sanitizeHtml(String(text)),
            });
        }
        return results;
    }

    async translate(txt_id: any, target_lang: string, source_lang: string): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) throw new ApiError(403, "No access to this text");
        const db = this.#app.db;
        const input = String(await db.one`SELECT text FROM text WHERE id = ${txt_id} AND lang = ${source_lang}` ?? "");
        if (!input.trim()) throw new ApiError(400, "Source text is empty");
        let output = await this.transl(input, target_lang, source_lang);
        if (!output) throw new ApiError(502, "Translation service returned nothing");

        if (/^[A-Z]/.test(input)) output = output.charAt(0).toUpperCase() + output.slice(1);

        await db.table("text").ensure({ id: txt_id, lang: target_lang, text: output });
        return true;
    }

    async translatePageAllLangs(pid: any, ifNeeded: boolean, subpages: boolean): Promise<{ count: number; fail: number }> {
        const stats = { count: 0, fail: 0 };
        for (const lang of this.#app.languages.all) {
            const result = await this.translatePage(pid, lang, "auto", ifNeeded, subpages);
            stats.count += result.count;
            stats.fail += result.fail;
        }
        return stats;
    }

    async translatePage(
        pid: any,
        target_lang: string,
        source_lang = "auto",
        ifNeeded = true,
        subpages = false
    ): Promise<{ count: number; fail: number }> {
        const stats = { count: 0, fail: 0 };
        const done = await this.translateCont(pid, target_lang, source_lang, ifNeeded);
        if (done === false) ++stats.fail;
        else stats.count += done;
        const node = await cms(this.#app).node(pid);
        const children = await node.children({ type: subpages ? "*" : "c" }) ?? new Map();
        for (const child of children.values()) {
            const result = await this.translatePage(child.id, target_lang, source_lang, ifNeeded, subpages);
            stats.count += result.count;
            stats.fail += result.fail;
        }
        return stats;
    }

    async translateCont(pid: any, target_lang: string, source_lang = "auto", ifNeeded = true): Promise<number | false> {
        const node = await cms(this.#app).node(pid);
        if (await node.access() < 2) return false;
        let count = 0;
        const title = await node.title();
        count += await this.translateText(title.id, target_lang, source_lang, ifNeeded);
        for (const text of Object.values(await node.texts()))
            count += await this.translateText((text as any).id, target_lang, source_lang, ifNeeded);
        return count;
    }

    async translateText(tid: number, target_lang: string, source_lang = "auto", ifNeeded = true): Promise<number> {
        const textEntry = this.#app.dbTexts.text(tid);

        if (ifNeeded && source_lang !== "clean" && (await textEntry.lang(target_lang).get()).trim()) return 0;

        if (source_lang === "auto") {
            source_lang = "";
            for (const lang of this.#app.languages.all) {
                if (lang === target_lang) continue;
                const source_text = await textEntry.lang(lang).get();
                if (source_text.trim() === "") continue;
                source_lang = lang;
            }
        }
        if (!source_lang) return 0;

        let text: string;
        if (source_lang === "clean") text = "";
        else {
            const sourceText = await textEntry.lang(source_lang).get();
            const translated = await this.transl(sourceText, target_lang, source_lang);
            if (!translated) return 0;
            text = translated;
        }
        await textEntry.lang(target_lang).set(text);
        return 1;
    }

    async transl(text: string, target_lang: string, source_lang: string): Promise<string | false> {
        if (source_lang && source_lang === target_lang) return text; // nothing to translate
        const service = String(await this.#app.settings["cms.text"]["translation service"] ?? "");
        if (service === "google") return this.googleTranslate(text, source_lang, target_lang);
        if (service === "deepl")  return this.deeplTranslate(text, source_lang, target_lang);
        throw new ApiError(400, "No translation service configured");
    }

    async deeplTranslate(text: string, source_lang: string, target_lang: string): Promise<string | false> {
        console.warn("deprecated? deepl used");
        const st = this.#app.settings["cms.text"];
        const params = new URLSearchParams({
            text,
            source_lang,
            target_lang,
            tag_handling: "xml",
            split_sentences: "1",
            preserve_formatting: "0",
            auth_key: String(await st.deepl.key ?? ""),
        });
        const resp = await fetch("https://api.deepl.com/v2/translate", {
            method: "POST",
            body: params,
        }).then((r) => r.json());
        const translation = resp?.translations?.[0]?.text ?? false;
        if (translation) {
            const prev = Number(await st["translate char count"] ?? "0");
            st["translate char count"](prev + text.length);
        }
        return translation;
    }

    async googleTranslate(text: string, source_lang: string, target_lang: string): Promise<string | false> {
        const st = this.#app.settings["cms.text"];
        const key =
            String(await st.google.key ?? "") ||
            String(await this.#app.settings["cms.backend.webmaster"]["google.api.key"] ?? "");
        const params = new URLSearchParams({
            q: text,
            target: target_lang,
            format: "html",
            source: source_lang,
            model: "nmt",
            key,
        });
        const resp = await fetch("https://translation.googleapis.com/language/translate/v2?" + params);
        if (!resp.ok) { console.error("[googleTranslate]", resp.status, await resp.text()); throw new ApiError(502, "Translation service request failed"); }
        const result = await resp.json();
        const translation = result?.data?.translations?.[0]?.translatedText ?? false;
        if (translation) {
            const prev = Number(await st["translate char count"] ?? "0");
            st["translate char count"](prev + text.length);
        }
        return translation;
    }

    async history(txt_id: any, lang: string): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) return false;
        const SPACE = 0; // cms_vers::$space — cms.versions not ported yet
        const rows = await this.#app.db.query`
            SELECT text.text, log.id as log_id, log.time as log_time, usr.email as email
            FROM
             _vers_text text
             LEFT JOIN log ON text._vers_log = log.id
             LEFT JOIN sess ON log.sess_id = sess.id
             LEFT JOIN usr ON sess.usr_id = usr.id
            WHERE
              text._vers_log
              AND text.id = ${txt_id}
              AND text.lang = ${lang}
              AND text._vers_space = ${SPACE}
            ORDER BY text._vers_log DESC
            LIMIT 100`;
        for (const row of rows) if (row.text) row.text = sanitizeHtml(String(row.text)); // dialog renders it via innerHTML
        return rows;
    }

    async isTranslated(txt_ids: any, lang: any): Promise<any> {
        const ids = (Array.isArray(txt_ids) ? txt_ids : [txt_ids]).map(Number).filter(Number.isFinite);
        if (!ids.length) return Array.isArray(txt_ids) ? {} : false;
        lang ??= this.ctx.lang;
        const rows = await this.#app.db.query`SELECT id, text FROM text WHERE id IN (${sql.join(ids.map((i) => sql`${i}`))}) AND lang = ${lang}`;
        const map: Record<number, boolean> = {};
        for (const row of rows) map[row.id] = !!row.text;
        if (!Array.isArray(txt_ids)) return map[ids[0]] ?? false;
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
                execute: ({ ids, lang }: any, ctx: Ctx) => service(ctx).isTranslated(ids.split("_").map(Number), lang ?? null),
            },
        },
        ":text": {
            paramSchema: s.number().describe("Text-ID"),
            get: {
                description: "Read text in all languages",
                access: Access.USER, // fine-grained check via textAccess() in execute
                execute: ({ text }: any, ctx: Ctx) => service(ctx).get(text),
            },
            translate: {
                post: {
                    description: "Translate text into a target language",
                    access: Access.USER,
                    input: s.object({
                        target_lang: s.string().describe("Target language code, e.g. \"en\""),
                        source_lang: s.string().describe("Source language code, e.g. \"de\""),
                    }),
                    execute: ({ text, target_lang, source_lang }: any, ctx: Ctx) =>
                        service(ctx).translate(text, target_lang, source_lang),
                },
            },
            history: {
                get: {
                    description: "Read text history for a language",
                    access: Access.USER,
                    input: s.object({ lang: s.string().describe("Language code, e.g. \"de\"") }),
                    execute: ({ text, lang }: any, ctx: Ctx) => service(ctx).history(text, lang),
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
                        target_lang: s.string().describe("Target language code, e.g. \"en\""),
                        source_lang: s.optional(s.string()).describe("Source language code. Default: auto-detect"),
                        ifNeeded: s.optional(s.boolean()).describe("Skip already translated texts"),
                        subpages: s.optional(s.boolean()).describe("Include sub-pages"),
                    }),
                    execute: ({ page, target_lang, source_lang, ifNeeded, subpages }: any, ctx: Ctx) =>
                        service(ctx).translatePage(page, target_lang, source_lang ?? "auto", ifNeeded ?? true, subpages ?? false),
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
                    execute: ({ page, ifNeeded, subpages }: any, ctx: Ctx) =>
                        service(ctx).translatePageAllLangs(page, ifNeeded ?? true, subpages ?? false),
                },
            },
        },
    },
};
