import * as nodePath from "node:path";
import { constants as fsConstants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { hee } from "../../core/lib/util.ts"
import { getCtx } from "../../core/lib/RequestContext.ts";
import { typeByExtension } from "../../../deps.ts";

export default async function codemirrorView(file: string): Promise<string> {
    const ctx = getCtx();
    const html = ctx.html;

    html.addCSSFile(ctx.sysURL + "core/pub/css/q1Rst.css");
    html.addCSSFile("https://cdn.jsdelivr.net/gh/u1ui/norm.css@3.2.0/norm.min.css");
    html.addCSSFile("https://cdn.jsdelivr.net/gh/u1ui/base.css@3.2.0/base.min.css");

    html.addJSFile(ctx.sysURL + "core/pub/js/c1.js");
    html.addJSFile(ctx.sysURL + "core/pub/js/qg.js");

    const version = "5.65.5";
    const url = `https://cdn.jsdelivr.net/npm/codemirror@${version}`;
    const min = "min.";

    html.addCSSFile(`${url}/lib/codemirror.${min}css`);
    html.addCSSFile(`${url}/theme/eclipse.${min}css`);

    html.addJSFile(`${url}/lib/codemirror.${min}js`);

    html.addJSFile(`${url}/addon/hint/show-hint.${min}js`);
    html.addCSSFile(`${url}/addon/hint/show-hint.${min}css`);
    html.addJSFile(`${url}/addon/hint/javascript-hint.${min}js`);

    html.addJSFile(`${url}/addon/scroll/annotatescrollbar.${min}js`);
    html.addJSFile(`${url}/addon/search/matchesonscrollbar.${min}js`);
    html.addJSFile(`${url}/addon/search/searchcursor.${min}js`);
    html.addJSFile(`${url}/addon/search/match-highlighter.${min}js`);

    html.addJSFile(`${url}/addon/fold/xml-fold.${min}js`);
    html.addJSFile(`${url}/addon/edit/matchtags.${min}js`);

    html.addJSFile(`${url}/addon/edit/trailingspace.${min}js`);

    html.addJSFile(`${url}/mode/xml/xml.${min}js`);
    html.addJSFile(`${url}/mode/javascript/javascript.${min}js`);
    html.addJSFile(`${url}/mode/css/css.${min}js`);
    html.addJSFile(`${url}/mode/clike/clike.${min}js`);
    html.addJSFile(`${url}/mode/php/php.${min}js`);
    html.addJSFile(`${url}/mode/htmlmixed/htmlmixed.${min}js`);

    html.addJSFile(`${url}/keymap/sublime.${min}js`);

    html.addJSM(ctx.sysURL + "fileEditor/pub/main.mjs");
    html.addCSSFile(ctx.sysURL + "fileEditor/pub/main.css");

    html.title = nodePath.basename(file) + " | Editor";

    const ext = file.replace(/.*\.([^.]+)/, "$1");
    const mime = extToCodeMirrorMime(ext);

    let isWritable = false;
    try {
        await nodeFs.access(file, fsConstants.W_OK);
        isWritable = true;
    } catch { /* not writable */ }

    const content = await Deno.readTextFile(file);
    const line = ctx.get["line"] ?? "";
    const col = ctx.get["col"] ?? "";

    return `<button
			class=q1Rst
			id=saveButton
			style="position:fixed;right:-1px;top:10px;z-index:10;padding:10px 12px;display:none;background-image:linear-gradient(rgba(255,255,255,.5),rgba(205,205,205,.5))">
			${isWritable ? "save" : "no write permission!"}
		</button>
		<div style="height:100%;width:100%">
			<textarea id=editor name="textareaContentCanBeCachedOnReload${Date.now()}" mime="${hee(mime)}" line="${hee(String(line))}" col="${hee(String(col))}" style="width:100%;height:100%">${hee(content)}</textarea>
		</div>`;
}

function extToCodeMirrorMime(ext: string): string {
    const overrides: Record<string, string> = {
        ts: "text/typescript",
        tsx: "text/typescript-jsx",
        mjs: "text/javascript",
        cjs: "text/javascript",
    };
    if (overrides[ext]) return overrides[ext];
    const mime = typeByExtension(ext) ?? "application/octet-stream";
    if (mime === "image/svg+xml") return "application/xml";
    return mime.replace("application/x-javascript", "text/javascript");
}
