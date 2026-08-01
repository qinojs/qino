import * as nodePath from "node:path";
import { constants as fsConstants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { typeByExtension } from "@std/media-types";
import { hee, getCtx, u2Root } from "../../core/mod.ts";

export default async function codemirrorView(file: string): Promise<string> {
  const ctx = getCtx();
  const html = ctx.res.html;

  html.styles.add(u2Root + "css/norm/norm.css");
  html.styles.add(u2Root + "css/base/base.css");

  html.legacyScripts.add(ctx.req.modulePath + "core/pub/js/c1.js");

  const url = "https://cdn.jsdelivr.net/npm/codemirror@5.65.5";
  const min = "min.";

  html.styles.add(`${url}/lib/codemirror.${min}css`);
  html.styles.add(`${url}/theme/eclipse.${min}css`);

  html.legacyScripts.add(`${url}/lib/codemirror.${min}js`);

  html.legacyScripts.add(`${url}/addon/hint/show-hint.${min}js`);
  html.styles.add(`${url}/addon/hint/show-hint.${min}css`);
  html.legacyScripts.add(`${url}/addon/hint/javascript-hint.${min}js`);

  html.legacyScripts.add(`${url}/addon/scroll/annotatescrollbar.${min}js`);
  html.legacyScripts.add(`${url}/addon/search/matchesonscrollbar.${min}js`);
  html.legacyScripts.add(`${url}/addon/search/searchcursor.${min}js`);
  html.legacyScripts.add(`${url}/addon/search/match-highlighter.${min}js`);

  html.legacyScripts.add(`${url}/addon/fold/xml-fold.${min}js`);
  html.legacyScripts.add(`${url}/addon/edit/matchtags.${min}js`);

  html.legacyScripts.add(`${url}/addon/edit/trailingspace.${min}js`);

  html.legacyScripts.add(`${url}/mode/xml/xml.${min}js`);
  html.legacyScripts.add(`${url}/mode/javascript/javascript.${min}js`);
  html.legacyScripts.add(`${url}/mode/css/css.${min}js`);
  html.legacyScripts.add(`${url}/mode/clike/clike.${min}js`);
  html.legacyScripts.add(`${url}/mode/php/php.${min}js`);
  html.legacyScripts.add(`${url}/mode/htmlmixed/htmlmixed.${min}js`);

  html.legacyScripts.add(`${url}/keymap/sublime.${min}js`);

  html.scripts.add(ctx.req.modulePath + "fileEditor/pub/main.mjs");
  html.styles.add(ctx.req.modulePath + "fileEditor/pub/main.css");

  html.title = nodePath.basename(file) + " | Editor";

  const mime = extToCodeMirrorMime(file.replace(/.*\.([^.]+)/, "$1"));

  let isWritable = false;
  try {
    await nodeFs.access(file, fsConstants.W_OK);
    isWritable = true;
  } catch { /* not writable */ }

  const content = await Deno.readTextFile(file);
  const line = ctx.req.query.line ?? "";
  const col = ctx.req.query.col ?? "";

  return `<button id=saveButton
    style="position:fixed;right:-1px;top:.625rem;z-index:10;padding:.625rem .75rem;display:none;background-image:linear-gradient(rgba(255,255,255,.5),rgba(205,205,205,.5))">
    ${isWritable ? "save" : "no write permission!"}
  </button>
  <div style="height:100%;width:100%">
    <textarea id=editor name="textareaContentCanBeCachedOnReload${Date.now()}" mime="${hee(mime)}"
      line="${hee(line)}" col="${hee(col)}" style="width:100%;height:100%">${hee(content)}</textarea>
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
