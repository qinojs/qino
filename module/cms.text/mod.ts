/**
 * cms.text/mod.ts
 * Port of cms.text/qg.php
 */

// deno-lint-ignore-file no-explicit-any

import { s } from "../core/lib/StandardSchema.ts";
import type { App } from "../core/server.ts";
import { Access, type AptTree } from "../core/lib/apt/mod.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

export const name = "cms.text";
export const needs = ["cms"];

export const settingsSchema = {
    properties: {
        "translation service": {
            type: "string",
            enum: ["", "google", "deepl"],
            description: "Which translation service is used for automatic translations",
        },
        deepl: {
            properties: {
                key: {
                    type: "string",
                    description: "API key for DeepL",
                },
            },
        },
        google: {
            properties: {
                key: {
                    type: "string",
                    description: "API key for Google Translate",
                },
            },
        },
        "translate char count": {
            type: "integer",
            description: "Counter for automatically translated characters",
        },
    },
};

export function init(app: App) {
    app.aptTree["cms.text"] = api;

    app.on("cms-ready", e => {
        const ctx = e.ctx as RequestContext;
        if (!ctx.state.editmode) return;
        if (ctx.get.qgCmsNoFrontend) return;
        ctx.html.addJSM(ctx.sysURL + "cms.text/pub/init.mjs");
    });
}

const cmsTextService: any = {

    async textAccess(text_id: any): Promise<boolean> {
        text_id = Number(text_id);
        const pid = await this.ctx.app.apt.cms["node-id-from-txt-id"].get({ id: text_id }).then((r: any) => r?.id ?? null).catch(() => null);
        if (!pid) return false;
        const P = await this.ctx.app.cms.node(pid);
        if ((await P.access()) < 2) return false;
        return true;
    },

    async get(txt_id: any): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) return false;
        const return_: any[] = [];
        for (const l of this.ctx.app.languages.all) {
            let text = await this.ctx.app.db.one("SELECT text FROM text WHERE id = ? AND lang = ?", [txt_id, l]);
            if (text == null || text === "") text = false;
            return_.push({ lang: l, text });
        }
        return return_;
    },

    async translate(txt_id: any, target_lang: string, source_lang: string): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) return false;
        const input = String(await this.ctx.app.db.one("SELECT text FROM text WHERE id = ? AND lang = ?", [txt_id, source_lang]) ?? "");
        if (!input.trim()) return false;
        let output = await this.transl(input, target_lang, source_lang);
        if (output === false) return false;

        if (input && /^[A-Z]/.test(input[0] ?? "")) {
            output = output.charAt(0).toUpperCase() + output.slice(1);
        }

        const exists = await this.ctx.app.db.one("SELECT id FROM text WHERE id = ? AND lang = ?", [txt_id, target_lang]);
        if (exists) {
            await this.ctx.app.db.table("text").update({ id: txt_id, lang: target_lang, text: output });
        } else {
            await this.ctx.app.db.table("text").insert({ id: txt_id, lang: target_lang, text: output });
        }
        return true;
    },

    async translatePageAllLangs(pid: any, ifNeeded: boolean, subpages: boolean): Promise<{ count: number; fail: number }> {
        const return_ = { count: 0, fail: 0 };
        for (const l of this.ctx.app.languages.all) {
            const result = await this.translatePage(pid, l, "auto", ifNeeded, subpages);
            return_.count += result.count;
            return_.fail += result.fail;
        }
        return return_;
    },

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
    },

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
    },

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
    },

    async transl(text: string, target_lang: string, source_lang: string): Promise<string | false> {
        const service = String(await this.ctx.app.settings["cms.text"]["translation service"] ?? "");
        switch (service) {
            case "google": return this.google_translate(text, source_lang, target_lang);
            case "deepl":  return this.deepl_translate(text, source_lang, target_lang);
        }
        return false;
    },

    async deepl_translate(text: string, source_lang: string, target_lang: string): Promise<string | false> {
        console.warn("deprecated? deepl used");
        const params = new URLSearchParams({
            text,
            source_lang,
            target_lang,
            tag_handling: "xml",
            split_sentences: "1",
            preserve_formatting: "0",
            auth_key: String(await this.ctx.app.settings["cms.text"]["deepl"]["key"] ?? ""),
        });
        const resp = await fetch("https://api.deepl.com/v2/translate", {
            method: "POST",
            body: params,
        }).then((r) => r.json());
        const translation: string | false = resp?.translations?.[0]?.text ?? false;
        if (translation) {
            const prev = Number(await this.ctx.app.settings["cms.text"]["translate char count"] ?? "0");
            this.ctx.app.settings["cms.text"]["translate char count"] = prev + text.length;
        }
        return translation;
    },

    async google_translate(text: string, source_lang: string, target_lang: string): Promise<string | false> {
        const key =
            String(await this.ctx.app.settings["cms.text"]["google"]["key"] ?? "") ||
            String(await this.ctx.app.settings["cms.backend.webmaster"]["google.api.key"] ?? "");
        const params = new URLSearchParams({
            q: text,
            target: target_lang,
            format: "html",
            source: source_lang,
            model: "nmt",
            key,
        });
        const result = await fetch(
            "https://translation.googleapis.com/language/translate/v2?" + params
        ).then((r) => r.json());
        const translation: string | false = result?.data?.translations?.[0]?.translatedText ?? false;
        if (translation) {
            console.log(await this.ctx.app.settings["cms.text"]["translate char count"]);
            const prev = Number(await this.ctx.app.settings["cms.text"]["translate char count"] ?? "0");
            this.ctx.app.settings["cms.text"]["translate char count"] = prev + text.length;
        }
        return translation;
    },

    async history(txt_id: any, lang: string): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) return false;
        const space = 0; // cms_vers::$space — cms.versions not ported yet
        const sql =
            " SELECT text.text, log.id as log_id, log.time as log_time, usr.email as email " +
            " FROM " +
            "  _vers_text text " +
            "  LEFT JOIN log ON text._vers_log = log.id " +
            "  LEFT JOIN sess ON log.sess_id = sess.id " +
            "  LEFT JOIN usr ON sess.usr_id = usr.id " +
            " WHERE " +
            "   text._vers_log " +
            "   AND text.id = ? " +
            "   AND text.lang = ? " +
            "   AND text._vers_space = ? " +
            " ORDER BY text._vers_log DESC " +
            " LIMIT 100 ";
        return this.ctx.app.db.all(sql, [txt_id, lang, space]);
    },

    async isTranslated(txt_id: any, lang: any): Promise<any> {
        txt_id = Number(txt_id);
        if (!await this.textAccess(txt_id)) return false;
        lang ??= this.ctx.lang;
        const text = await this.ctx.app.db.one("SELECT text FROM text WHERE id = ? AND lang = ?", [txt_id, lang]);
        return !!(text && text !== "");
    },
};

export function service(ctx: any): any {
    const svc = Object.create(cmsTextService);
    svc.ctx = ctx;
    return svc;
}

export const api: AptTree = {
    text: {
        ":text": {
            paramSchema: s.number().describe("Text-ID"),
            get: {
                description: "Read text in all languages",
                access: Access.USER, // fine-grained check via textAccess() in execute
                execute: ({ text }: any, ctx: any) => service(ctx).get(text),
            },
            translate: {
                post: {
                    description: "Translate text into a target language",
                    access: Access.USER,
                    input: s.object({
                        target_lang: s.string().describe("Target language code, e.g. \"en\""),
                        source_lang: s.string().describe("Source language code, e.g. \"de\""),
                    }),
                    execute: ({ text, target_lang, source_lang }: any, ctx: any) =>
                        service(ctx).translate(text, target_lang, source_lang),
                },
            },
            history: {
                get: {
                    description: "Read text history for a language",
                    access: Access.USER,
                    input: s.object({ lang: s.string().describe("Language code, e.g. \"de\"") }),
                    execute: ({ text, lang }: any, ctx: any) => service(ctx).history(text, lang),
                },
            },
            "is-translated": {
                get: {
                    description: "Check if text is translated in a language",
                    access: Access.USER,
                    input: s.object({ lang: s.optional(s.string()).describe("Language code. Default: current language") }),
                    execute: ({ text, lang }: any, ctx: any) => service(ctx).isTranslated(text, lang ?? null),
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
                    execute: ({ page, target_lang, source_lang, ifNeeded, subpages }: any, ctx: any) =>
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
                    execute: ({ page, ifNeeded, subpages }: any, ctx: any) =>
                        service(ctx).translatePageAllLangs(page, ifNeeded ?? true, subpages ?? false),
                },
            },
        },
    },
};


/**
 * cms.text install()
 * Port of cms.text/install.php
 */
export async function install({ app }: any): Promise<void> {
    app.settings["cms.text"]["translation service"];
}
