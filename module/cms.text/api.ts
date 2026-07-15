// deno-lint-ignore-file no-explicit-any

import { s, Access, AptError, sql, type AptTree, type Ctx } from "../core/mod.ts";
import { sanitizeHtml } from "../cms/mod.ts";

class CmsTextService {

    #ctx: Ctx;

    constructor(ctx: Ctx) {
        this.#ctx = ctx;
    }

    get ctx(): Ctx { return this.#ctx; }

    async textAccess(text_id: any): Promise<boolean> {
        text_id = Number(text_id);
        const pid = await this.ctx.app.apt.cms["node-id-from-txt-id"].get({ id: text_id }).then((r: any) => r?.id ?? null).catch(() => null);
        if (!pid) return false;
        const P = await this.ctx.app.cms.node(pid);
        if ((await P.access()) < 2) return false;
        return true;
    }

    async get(txt_id: any): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) return false;
        const return_: any[] = [];
        for (const l of this.ctx.app.languages.all) {
            const text = await this.ctx.app.db.one`SELECT text FROM text WHERE id = ${txt_id} AND lang = ${l}`;
            return_.push({
                lang: l,
                text: !text ? false : sanitizeHtml(String(text)),
            });
        }
        return return_;
    }

    async translate(txt_id: any, target_lang: string, source_lang: string): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) throw new AptError(403, "No access to this text");
        const db = this.ctx.app.db;
        const input = String(await db.one`SELECT text FROM text WHERE id = ${txt_id} AND lang = ${source_lang}` ?? "");
        if (!input.trim()) throw new AptError(400, "Source text is empty");
        let output = await this.transl(input, target_lang, source_lang);
        if (!output) throw new AptError(502, "Translation service returned nothing");

        if (input && /^[A-Z]/.test(input[0] ?? "")) {
            output = output.charAt(0).toUpperCase() + output.slice(1);
        }

        const exists = await db.one`SELECT id FROM text WHERE id = ${txt_id} AND lang = ${target_lang}`;
        if (exists) {
            await db.table("text").update({ id: txt_id, lang: target_lang, text: output });
        } else {
            await db.table("text").insert({ id: txt_id, lang: target_lang, text: output });
        }
        return true;
    }

    async translatePageAllLangs(pid: any, ifNeeded: boolean, subpages: boolean): Promise<{ count: number; fail: number }> {
        const return_ = { count: 0, fail: 0 };
        for (const l of this.ctx.app.languages.all) {
            const result = await this.translatePage(pid, l, "auto", ifNeeded, subpages);
            return_.count += result.count;
            return_.fail += result.fail;
        }
        return return_;
    }

    async translatePage(
        pid: any,
        target_lang: string,
        source_lang = "auto",
        ifNeeded = true,
        subpages = false
    ): Promise<{ count: number; fail: number }> {
        const return_ = { count: 0, fail: 0 };
        const done = await this.translateCont(pid, target_lang, source_lang, ifNeeded);
        if (done === false) ++return_.fail;
        else return_.count += done;
        const node = await this.ctx.app.cms.node(pid);
        const children = await node.children({ type: subpages ? "*" : "c" }) ?? new Map();
        for (const Child of children.values()) {
            const result = await this.translatePage(Child.id, target_lang, source_lang, ifNeeded, subpages);
            return_.count += result.count;
            return_.fail += result.fail;
        }
        return return_;
    }

    async translateCont(pid: any, target_lang: string, source_lang = "auto", ifNeeded = true): Promise<number | false> {
        const node = await this.ctx.app.cms.node(pid);
        if ((await node.access()) < 2) return false;
        let count = 0;
        const Title = await node.title();
        count += await this.translateText(Title.id, target_lang, source_lang, ifNeeded);
        const texts = await node.texts();
        for (const Text of Object.values(texts)) {
            count += await this.translateText((Text as any).id, target_lang, source_lang, ifNeeded);
        }
        return count;
    }

    async translateText(tid: number, target_lang: string, source_lang = "auto", ifNeeded = true): Promise<number> {
        const Text = this.ctx.app.dbTexts.text(tid);

        if (ifNeeded && source_lang !== "clean" && (await Text.lang(target_lang).get()).trim()) return 0;

        if (source_lang === "auto") {
            source_lang = "";
            for (const l of this.ctx.app.languages.all) {
                if (l === target_lang) continue;
                const source_text = await Text.lang(l).get();
                if (source_text.trim() === "") continue;
                source_lang = l;
            }
        }
        if (!source_lang) return 0;

        let text: string;
        if (source_lang === "clean") {
            text = "";
        } else {
            const sourceText = await Text.lang(source_lang).get();
            const translated = await this.transl(sourceText, target_lang, source_lang);
            if (!translated) return 0;
            text = translated;
        }
        await Text.lang(target_lang).set(text);
        return 1;
    }

    async transl(text: string, target_lang: string, source_lang: string): Promise<string | false> {
        if (source_lang && source_lang === target_lang) return text; // nothing to translate
        const service = String(await this.ctx.app.settings["cms.text"]["translation service"] ?? "");
        if (service === "google") return this.google_translate(text, source_lang, target_lang);
        if (service === "deepl")  return this.deepl_translate(text, source_lang, target_lang);
        throw new AptError(400, "No translation service configured");
    }

    async deepl_translate(text: string, source_lang: string, target_lang: string): Promise<string | false> {
        console.warn("deprecated? deepl used");
        const st = this.ctx.app.settings["cms.text"];
        const params = new URLSearchParams({
            text,
            source_lang,
            target_lang,
            tag_handling: "xml",
            split_sentences: "1",
            preserve_formatting: "0",
            auth_key: String(await st["deepl"]["key"] ?? ""),
        });
        const resp = await fetch("https://api.deepl.com/v2/translate", {
            method: "POST",
            body: params,
        }).then((r) => r.json());
        const translation: string | false = resp?.translations?.[0]?.text ?? false;
        if (translation) {
            const prev = Number(await st["translate char count"] ?? "0");
            st["translate char count"](prev + text.length);
        }
        return translation;
    }

    async google_translate(text: string, source_lang: string, target_lang: string): Promise<string | false> {
        const st = this.ctx.app.settings["cms.text"];
        const key =
            String(await st["google"]["key"] ?? "") ||
            String(await this.ctx.app.settings["cms.backend.webmaster"]["google.api.key"] ?? "");
        const params = new URLSearchParams({
            q: text,
            target: target_lang,
            format: "html",
            source: source_lang,
            model: "nmt",
            key,
        });
        const resp = await fetch("https://translation.googleapis.com/language/translate/v2?" + params);
        if (!resp.ok) { console.error("[google_translate]", resp.status, await resp.text()); throw new AptError(502, "Translation service request failed"); }
        const result = await resp.json();
        const translation: string | false = result?.data?.translations?.[0]?.translatedText ?? false;
        if (translation) {
            const prev = Number(await st["translate char count"] ?? "0");
            st["translate char count"](prev + text.length);
        }
        return translation;
    }

    async history(txt_id: any, lang: string): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) return false;
        const space = 0; // cms_vers::$space — cms.versions not ported yet
        const rows = await this.ctx.app.db.query`
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
              AND text._vers_space = ${space}
            ORDER BY text._vers_log DESC
            LIMIT 100`;
        for (const row of rows) if (row.text) row.text = sanitizeHtml(String(row.text)); // dialog renders it via innerHTML
        return rows;
    }

    async isTranslated(txt_ids: any, lang: any): Promise<any> {
        const ids = (Array.isArray(txt_ids) ? txt_ids : [txt_ids]).map(Number).filter(Number.isFinite);
        if (!ids.length) return Array.isArray(txt_ids) ? {} : false;
        lang ??= this.ctx.lang;
        const rows = await this.ctx.app.db.query`SELECT id, text FROM text WHERE id IN (${sql.join(ids.map((i) => sql`${i}`))}) AND lang = ${lang}`;
        const map: Record<number, boolean> = {};
        for (const row of rows) map[row.id] = !!(row.text && row.text !== "");
        if (!Array.isArray(txt_ids)) return map[ids[0]] ?? false;
        return Object.fromEntries(ids.map(id => [id, map[id] ?? false]));
    }
}

export const service = (ctx: Ctx): CmsTextService => new CmsTextService(ctx);

export const api: AptTree = {
    text: {
        "are-translated": {
            get: {
                description: "Batch-check if multiple texts are translated in a language",
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
