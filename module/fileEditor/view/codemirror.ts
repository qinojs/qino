import * as nodePath from "node:path";
import { constants as fsConstants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { typeByExtension } from "@std/media-types";
import { html, getCtx } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

export default async function codemirrorView(file: string): Promise<string> {
  const ctx = getCtx();
  const resHtml = ctx.res.html;

  u2.assets(ctx, ["css/norm/norm.css", "css/base/base.css"]);

  resHtml.scripts.add(ctx.req.moduleUrl + "core/pub/js/c1.js");

  const CDN = "https://cdn.jsdelivr.net/npm/codemirror@5.65.5";
  const MIN = "min.";

  // declaring the source is what lets it load at all — and what uncdn proxies against
  ctx.res.csp["script-src"][CDN] = true;
  ctx.res.csp["style-src"][CDN] = true;

  resHtml.styles.add(`${CDN}/lib/codemirror.${MIN}css`);
  resHtml.styles.add(`${CDN}/theme/eclipse.${MIN}css`);

  resHtml.legacyScripts.add(`${CDN}/lib/codemirror.${MIN}js`);

  resHtml.legacyScripts.add(`${CDN}/addon/hint/show-hint.${MIN}js`);
  resHtml.styles.add(`${CDN}/addon/hint/show-hint.${MIN}css`);
  resHtml.legacyScripts.add(`${CDN}/addon/hint/javascript-hint.${MIN}js`);

  resHtml.legacyScripts.add(`${CDN}/addon/scroll/annotatescrollbar.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/addon/search/matchesonscrollbar.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/addon/search/searchcursor.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/addon/search/match-highlighter.${MIN}js`);

  resHtml.legacyScripts.add(`${CDN}/addon/fold/xml-fold.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/addon/edit/matchtags.${MIN}js`);

  resHtml.legacyScripts.add(`${CDN}/addon/edit/trailingspace.${MIN}js`);

  resHtml.legacyScripts.add(`${CDN}/mode/xml/xml.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/mode/javascript/javascript.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/mode/css/css.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/mode/clike/clike.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/mode/php/php.${MIN}js`);
  resHtml.legacyScripts.add(`${CDN}/mode/htmlmixed/htmlmixed.${MIN}js`);

  resHtml.legacyScripts.add(`${CDN}/keymap/sublime.${MIN}js`);

  resHtml.scripts.add(ctx.req.moduleUrl + "fileEditor/pub/main.mjs");
  resHtml.styles.add(ctx.req.moduleUrl + "fileEditor/pub/main.css");

  resHtml.title = nodePath.basename(file) + " | Editor";

  const mime = extToCodeMirrorMime(file.replace(/.*\.([^.]+)/, "$1"));

  const isWritable = await nodeFs.access(file, fsConstants.W_OK).then(() => true).catch(() => false);

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
