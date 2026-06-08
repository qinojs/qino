import { hee } from "./util.ts";
import type { RequestContext } from "./RequestContext.ts";

//export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export class HtmlBuilder {
    head = "";
    title = "";
    titlePrefix = "";
    titleSuffix = "";
    meta: Record<string, string> = {};
    link: Record<string, Record<string, string>> = {};
    scripts: Set<string> = new Set<string>();
    styles: Set<string> = new Set<string>();
    legacyScripts: Set<string> = new Set<string>();
    importMap: Map<string, string> = new Map<string, string>();
    content = "";
    #jsData?: Record<string, unknown>;
    #ctx: RequestContext;

    constructor(ctx: RequestContext) {
        this.#ctx = ctx;
    }

    get jsData(): Record<string, unknown> { return this.#jsData ??= {}; }

    getHeader(): string {
        let ret = '<meta charset="utf-8">\n';

        for (const [name, value] of Object.entries(this.meta)) {
            if (value === "") continue;
            ret += `<meta name=${hee(name)} content="${hee(value)}">\n`;
        }

        ret += `<title>${hee(this.titlePrefix + this.title + this.titleSuffix)}</title>\n`;

        if (this.importMap.size) {
            const json = JSON.stringify({ imports: Object.fromEntries(this.importMap) }).replace(/</g, "\\u003c");
            ret += `<script type=importmap>${json}</script>\n`;
        }

        for (const [name, item] of Object.entries(this.link)) {
            ret += `<link href="${hee(name)}" `;
            for (const [k, val] of Object.entries(item)) ret += `${k}="${hee(val)}" `;
            ret += ">\n";
        }

        ret += this.head;

        for (const url of this.styles) ret += `<link rel=stylesheet href="${hee(url)}">\n`;

        if (this.#jsData) ret += `<script type=json/c1>${JSON.stringify(this.#jsData)}</script>\n`;


        for (const url of this.legacyScripts) ret += `<script defer src="${hee(url)}"></script>\n`;

        for (const url of this.scripts) ret += `<script type=module src="${hee(url)}"></script>\n`;

        return ret;
    }

    render(): string {
        const ctx = this.#ctx;
        this.jsData["qgToken"] = ctx.token;
        this.jsData["appURL"] = ctx.appURL || "/";
        this.jsData["sysURL"] = ctx.sysURL || "/m/";
        this.meta["viewport"] = "width=device-width";


        const { lang } = ctx;
        return `<!DOCTYPE HTML>\n<html lang=${lang}>\n\t<head>${this.getHeader()}\n\t<body>\n${this.content}\n`;
    }
}
