// deno-lint-ignore-file no-explicit-any

import { getCtx } from "./context.ts";
import { createHash } from "node:crypto";

export class LangManager {

    #app: any;
    #langs: string[] = [];   // alle verfügbaren Sprachen, erste = default
    #txtsCache: Record<string, Record<string, string>> = {};

    constructor(app: any) {
        this.#app = app;
        this.t = this.t.bind(this);
    }

    setLangs(langs: string[]): void {
        this.#langs = langs.map(l=>l.trim().toLowerCase()).filter(Boolean);
    }
    get def(): string { return this.#langs[0] ?? "en"; }
    get all(): string[] { return this.#langs; }

    // Sprache des Users (vor NS-Override)
    getUsr(ctx?: any): string {
        const c = ctx ?? this.#ctx();
        return c?.langUsr || this.def;
    }

    // Aktueller Namespace
    getNs(ctx?: any): string {
        const c = ctx ?? this.#ctx();
        return c?.langNs ?? "";
    }

    // Initialisiert Sprache pro Request (wie L.init)
    async initCtx(ctx: any): Promise<void> {
        const usr = ctx.user;

        ctx.langUsr = usr ? (await usr.get("lang") || "") : ctx.session.qg.lang() ?? "";

        const urlLang = ctx.get.changeLanguage;
        if (urlLang) {
            ctx.langUsr = urlLang;
        } else {
            const match = ctx.appRequestUri?.match(/^([a-z][a-z])(\/|$|\?)/);
            if (match) ctx.langUsr = match[1];
        }

        if (!this.#langs.includes(ctx.langUsr)) ctx.langUsr = "";
        if (ctx.langUsr === "") ctx.langUsr = this.#fromBrowser(ctx);

        if (usr) {
            await usr.set("lang", ctx.langUsr);
        } else {
            ctx.session.qg.lang(ctx.langUsr);
        }

        ctx.lang = ctx.langUsr;
        ctx.langNs = ctx.langNs ?? "";
        ctx.langNsPath = ctx.langNsPath ?? [];
    }

    async nsStart(ns: string, ctx?: any): Promise<void> {
        const c = ctx ?? this.#ctx();
        c.langNsPath.push(c.langNs);
        c.langNs = ns;
        const nsLang = String(await c.settings.qg.lang_ns[ns] ?? "");
        c.lang = (nsLang && this.#langs.includes(nsLang)) ? nsLang : this.getUsr(c);
    }

    nsStop(ctx?: any): void {
        const c = ctx ?? this.#ctx();
        c.langNs = c.langNsPath.pop() ?? "";
        c.lang = this.getUsr(c);
    }

    // Sprache aus dem Browser-Header ermitteln
    #fromBrowser(ctx: any): string {
        const acceptLang = ctx.server?.HTTP_ACCEPT_LANGUAGE;
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
            await this.addLanguage(l);
            this.#txtsCache[key] = await this.#app.db.indexCol(`SELECT hash, \`${l}\` as txt FROM smalltext WHERE namespace = ?`, [ns]);
        }
        return this.#txtsCache[key];
    }

    async #getTxt(string: string, ctx: any): Promise<string> {
        const hash = createHash("md5").update(string).digest("hex");
        const ns = ctx.langNs;
        const l = ctx.lang;
        const txts = await this.#getTxts(ns, l);
        if (!(hash in txts)) {
            await this.#app.db.query("INSERT INTO smalltext SET namespace=?, hash=?, de=?, original=?", [ns, hash, string, string]);
            txts[hash] = string;
        }
        return txts[hash] || string;
    }

    // Shortcut: Text übersetzen (nutzt automatisch den aktuellen ctx)
    async t(strings: TemplateStringsArray, ...values: (Promise<string> | string)[]): Promise<string> {
        const ctx = this.#ctx();
        
        // Originalstring aus den Template-Parts zusammensetzen (mit ###1### Platzhaltern)
        const original = strings.reduce((acc, str, i) => 
            acc + str + (i < strings.length - 1 ? `###${i + 1}###` : ""), "");
        
        // Übersetzten String holen
        let result = await this.#getTxt(original, ctx);
        
        // Werte auflösen und einsetzen
        const resolved = await Promise.all(values.map(v => v));
        for (let i = 0; i < resolved.length; i++) {
            result = result.replace(`###${i + 1}###`, resolved[i]);
        }
        return result;
    }


    // Sprache zur DB hinzufügen falls nicht vorhanden
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

    #ctx(): any {
        return getCtx();
    }
}
