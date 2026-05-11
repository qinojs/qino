/**
 * html.ts - HTML rendering utilities
 * Port of core/lib/html.class.php
 */

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
    jsFiles: Record<string, any> = {};
    cssFiles: Record<string, any> = {};
    jsms: Record<string, any> = {};
    content = "";

    constructor(private ctx: RequestContext) {}

    addJSFile(v: string): void { this.jsFiles[v] = true; }
    addCSSFile(v: string): void { this.cssFiles[v] = true; }
    addJSM(v: string): void { this.jsms[v] = true; }

    prependContent(str: string): void {
        this.content = str + this.content;
    }

    getHeader(): string {
        let ret = '<meta charset="utf-8">\n';

        for (const [name, item] of Object.entries(this.link)) {
            ret += `<link href="${hee(name)}" `;
            for (const [k, val] of Object.entries(item)) {
                ret += `${k}="${hee(val)}" `;
            }
            ret += ">\n";
        }

        ret += this.head;

        for (const url of Object.keys(this.cssFiles)) {
            ret += `<link rel=stylesheet href="${hee(url)}">\n`;
        }

        const jsData = this.ctx.state.js_data;
        if (jsData) ret += `<script type=json/c1>${JSON.stringify(jsData)}</script>\n`;

        for (const [name, value] of Object.entries(this.meta)) {
            if (value === "") continue;
            ret += `<meta name=${hee(name)} content="${hee(value)}">\n`;
        }

        ret += `<title>${hee(this.titlePrefix + this.title + this.titleSuffix)}</title>\n`;

        for (const url of Object.keys(this.jsFiles)) {
            ret += `<script defer src="${hee(url)}"></script>\n`;
        }

        for (const url of Object.keys(this.jsms)) {
            ret += `<script type=module src="${hee(url)}"></script>\n`;
        }

        return ret;
    }

    render(): string {
        const ctx = this.ctx;
        const g = ctx.state;
        if (!g.js_data) g.js_data = {};
        const jsData = g.js_data as Record<string, any>;
        jsData["qgToken"] = ctx.token;
        jsData["appURL"] = ctx.appURL || "/";
        jsData["sysURL"] = ctx.sysURL || "/m/";
        jsData["c1UseSrc"] = (ctx.sysURL || "/m/") + "core/pub/js";

        const lang = ctx.lang;
        return `<!DOCTYPE HTML>\n<html lang=${lang}>\n\t<head>${this.getHeader()}\n\t<body>\n${this.content}\n`;
    }
}