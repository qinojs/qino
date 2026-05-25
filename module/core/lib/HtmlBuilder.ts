// deno-lint-ignore-file no-explicit-any

import { hee } from "./util.ts";
import type { RequestContext } from "./RequestContext.ts";

export class HtmlBuilder {
    head = "";
    title = "";
    titlePrefix = "";
    titleSuffix = "";
    meta: Record<string, string> = {};
    link: Record<string, Record<string, string>> = {};
    scripts = new Set<string>();
    styles = new Set<string>();
    legacyScripts = new Set<string>();
    content = "";
    #jsData?: Record<string, any>;
    #ctx: RequestContext;

    constructor(ctx: RequestContext) {
        this.#ctx = ctx;
    }

    get jsData(): Record<string, any> { return this.#jsData ??= {}; }

    /** @deprecated use scripts */
    get jsms(): Set<string> { console.warn("HtmlBuilder.jsms is deprecated, use scripts", Error().stack); return this.scripts; }
    set jsms(files: Set<string>) { console.warn("HtmlBuilder.jsms is deprecated, use scripts", Error().stack); this.scripts = files; }
    /** @deprecated use styles */
    get cssFiles(): Set<string> { console.warn("HtmlBuilder.cssFiles is deprecated, use styles", Error().stack); return this.styles; }
    set cssFiles(files: Set<string>) { console.warn("HtmlBuilder.cssFiles is deprecated, use styles", Error().stack); this.styles = files; }
    /** @deprecated use scripts, or legacyScripts for classic scripts */
    get jsFiles(): Set<string> { console.warn("HtmlBuilder.jsFiles is deprecated, use scripts or legacyScripts", Error().stack); return this.legacyScripts; }
    set jsFiles(files: Set<string>) { console.warn("HtmlBuilder.jsFiles is deprecated, use scripts or legacyScripts", Error().stack); this.legacyScripts = files; }

    /** @deprecated use legacyScripts.add() */
    addJSFile(v: string): void { console.warn("HtmlBuilder.addJSFile() is deprecated, use legacyScripts.add()", Error().stack); this.legacyScripts.add(v); }
    /** @deprecated use styles.add() */
    addCSSFile(v: string): void { console.warn("HtmlBuilder.addCSSFile() is deprecated, use styles.add()", Error().stack); this.styles.add(v); }
    /** @deprecated use scripts.add() */
    addJSM(v: string): void { console.warn("HtmlBuilder.addJSM() is deprecated, use scripts.add()", Error().stack); this.scripts.add(v); }

    prependContent(str: string): void {
        this.content = str + this.content;
    }

    getHeader(): string {
        let ret = '<meta charset="utf-8">\n';

        for (const [name, item] of Object.entries(this.link)) {
            ret += `<link href="${hee(name)}" `;
            for (const [k, val] of Object.entries(item)) ret += `${k}="${hee(val)}" `;
            ret += ">\n";
        }

        ret += this.head;

        for (const url of this.styles) ret += `<link rel=stylesheet href="${hee(url)}">\n`;

        if (this.#jsData) ret += `<script type=json/c1>${JSON.stringify(this.#jsData)}</script>\n`;

        for (const [name, value] of Object.entries(this.meta)) {
            if (value === "") continue;
            ret += `<meta name=${hee(name)} content="${hee(value)}">\n`;
        }

        ret += `<title>${hee(this.titlePrefix + this.title + this.titleSuffix)}</title>\n`;

        for (const url of this.legacyScripts) ret += `<script defer src="${hee(url)}"></script>\n`;

        for (const url of this.scripts) ret += `<script type=module src="${hee(url)}"></script>\n`;

        return ret;
    }

    render(): string {
        const ctx = this.#ctx;
        this.jsData["qgToken"] = ctx.token;
        this.jsData["appURL"] = ctx.appURL || "/";
        this.jsData["sysURL"] = ctx.sysURL || "/m/";
        this.jsData["c1UseSrc"] = (ctx.sysURL || "/m/") + "core/pub/js";

        const { lang } = ctx;
        return `<!DOCTYPE HTML>\n<html lang=${lang}>\n\t<head>${this.getHeader()}\n\t<body>\n${this.content}\n`;
    }
}
