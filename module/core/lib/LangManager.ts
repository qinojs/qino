import { getCtx, type RequestContext } from "./RequestContext.ts";
import { createHash } from "node:crypto";
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
    get all(): string[] { return this.#langs; }

    setLangs(langs: string[]): void {
        this.#langs = langs.map(l=>l.trim().toLowerCase()).filter(Boolean);
    }

    // Initialises language per request (like L.init)
    async initCtx(ctx: RequestContext): Promise<void> {
        const usr = ctx.user;

        ctx.langUsr = usr ? (await usr.get("lang") ?? "") : ctx.session.qg.lang() ?? "";

        const urlLang = ctx.get.changeLanguage;
        if (urlLang) {
            ctx.langUsr = urlLang;
        } else {
            const match = ctx.appRequestUri?.match(/^([a-z][a-z])(\/|$|\?)/);
            if (match) ctx.langUsr = match[1];
        }

        if (!this.#langs.includes(ctx.langUsr)) ctx.langUsr = "";
        ctx.langUsr ||= this.#fromBrowser(ctx);

        if (usr) {
            usr.set("lang", ctx.langUsr); // save is debounced, no need to await
        } else {
            ctx.session.qg.lang(ctx.langUsr);
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
            //await this.addLanguage(l);
            this.#txtsCache[key] = await this.#app.db.indexCol(`SELECT hash, \`${l}\` as txt FROM smalltext WHERE namespace = ?`, [ns]) as Record<string, string>;
        }
        return this.#txtsCache[key];
    }

    async #getTxt(string: string, ctx: RequestContext): Promise<string> {
        const hash = createHash("md5").update(string).digest("hex");
        const ns = ctx.langNs;
        const l = ctx.lang;
        const txts = await this.#getTxts(ns, l);
        if (!(hash in txts)) {
            await this.#app.db.query("INSERT IGNORE INTO smalltext SET namespace=?, hash=?, original=?", [ns, hash, string]);
            txts[hash] = "";
        }
        const translated = txts[hash] || string;
        if (ctx.dev && !txts[hash]) {
            return `*${string}*`;
        }
        if (await this.#app.settings.core.smalltext.counter) {
            await this.#app.db.query("UPDATE smalltext SET count = count+1 WHERE hash = ? AND namespace = ?", [hash, ns]);
        }
        return translated;
    }

    // Shortcut: translate text (uses the current ctx automatically)
    async t(strings: TemplateStringsArray, ...values: unknown[]): Promise<string> {
        const ctx = getCtx();
        const original = strings.reduce((acc, str, i) => 
            acc + str + (i < strings.length - 1 ? `###${i + 1}###` : ""), "");
        let result = await this.#getTxt(original, ctx);
        const resolved = await Promise.all(values);
        for (let i = 0; i < resolved.length; i++) {
            result = result.replace(`###${i + 1}###`, String(resolved[i] ?? ""));
        }
        return result;
    }


    /*
    // Add language to the DB if not yet present
    async addLanguage(l: string): Promise<void> {
        const table = this.#app.db.table("smalltext");
        if (!table.field(l)) {
            await table.addField(l);
            await table.field(l).setType("text");
        }
    }

    async import(lang: string, ns: string, json: string): Promise<void> {
        await this.addLanguage(lang);
        const txts: Record<string, string> = JSON.parse(json);
        const db = this.#app.db;
        for (const [original, txt] of Object.entries(txts)) {
            if (!txt) continue;
            const hash = createHash("md5").update(original).digest("hex");
            const exists = await db.row("SELECT hash FROM smalltext WHERE hash = ? AND namespace = ?", [hash, ns]);
            if (!exists) await db.query("INSERT INTO smalltext SET namespace = ?, hash = ?, original = ?", [ns, hash, original]);
            await db.query(`UPDATE smalltext SET \`${lang}\` = ? WHERE hash = ? AND namespace = ?`, [txt, hash, ns]);
        }
    }
    */

}
