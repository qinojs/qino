import * as nodePath from "node:path";
import { constants as fsConstants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { typeByExtension } from "@std/media-types";
import { html, getCtx, u2Root } from "../../core/mod.ts";

export default async function codemirrorView(file: string): Promise<string> {
  const ctx = getCtx();
  const resHtml = ctx.res.html;

  resHtml.styles.add(u2Root + "css/norm/norm.css");
  resHtml.styles.add(u2Root + "css/base/base.css");

  resHtml.legacyScripts.add(ctx.req.moduleUrl + "core/pub/js/c1.js");

  const url = "https://cdn.jsdelivr.net/npm/codemirror@5.65.5";
  const min = "min.";

  resHtml.styles.add(`${url}/lib/codemirror.${min}css`);
  resHtml.styles.add(`${url}/theme/eclipse.${min}css`);

  resHtml.legacyScripts.add(`${url}/lib/codemirror.${min}js`);

  resHtml.legacyScripts.add(`${url}/addon/hint/show-hint.${min}js`);
  resHtml.styles.add(`${url}/addon/hint/show-hint.${min}css`);
  resHtml.legacyScripts.add(`${url}/addon/hint/javascript-hint.${min}js`);

  resHtml.legacyScripts.add(`${url}/addon/scroll/annotatescrollbar.${min}js`);
  resHtml.legacyScripts.add(`${url}/addon/search/matchesonscrollbar.${min}js`);
  resHtml.legacyScripts.add(`${url}/addon/search/searchcursor.${min}js`);
  resHtml.legacyScripts.add(`${url}/addon/search/match-highlighter.${min}js`);

  resHtml.legacyScripts.add(`${url}/addon/fold/xml-fold.${min}js`);
  resHtml.legacyScripts.add(`${url}/addon/edit/matchtags.${min}js`);

  resHtml.legacyScripts.add(`${url}/addon/edit/trailingspace.${min}js`);

  resHtml.legacyScripts.add(`${url}/mode/xml/xml.${min}js`);
  resHtml.legacyScripts.add(`${url}/mode/javascript/javascript.${min}js`);
  resHtml.legacyScripts.add(`${url}/mode/css/css.${min}js`);
  resHtml.legacyScripts.add(`${url}/mode/clike/clike.${min}js`);
  resHtml.legacyScripts.add(`${url}/mode/php/php.${min}js`);
  resHtml.legacyScripts.add(`${url}/mode/htmlmixed/htmlmixed.${min}js`);

  resHtml.legacyScripts.add(`${url}/keymap/sublime.${min}js`);

  resHtml.scripts.add(ctx.req.moduleUrl + "fileEditor/pub/main.mjs");
  resHtml.styles.add(ctx.req.moduleUrl + "fileEditor/pub/main.css");

  resHtml.title = nodePath.basename(file) + " | Editor";

  const mime = extToCodeMirrorMime(file.replace(/.*\.([^.]+)/, "$1"));

  let isWritable = false;
  try {
    await nodeFs.access(file, fsConstants.W_OK);
    isWritable = true;
  } catch { /* not writable */ }

  const content = await Deno.readTextFile(file);
  const line = ctx.req.query.line ?? "";
  const col = ctx.req.query.col ?? "";

  return String(html`<button id=saveButton
    style="position:fixed;right:-1px;top:.625rem;z-index:10;padding:.625rem .75rem;display:none;background-image:linear-gradient(rgba(255,255,255,.5),rgba(205,205,205,.5))">
    ${isWritable ? "save" : "no write permission!"}
  </button>
  <div style="height:100%;width:100%">
    <textarea id=editor name="textareaContentCanBeCachedOnReload${Date.now()}" mime="${mime}"
      line="${line}" col="${col}" style="width:100%;height:100%">${content}</textarea>
  </div>`); // res.html.content is a plain string
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
