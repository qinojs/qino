import * as nodePath from "node:path";
import { html, getCtx, Output } from "@qino/qino";
import { editorUrl } from "@qino/qino/fileEditor";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

function inRoot(file: string, root: string): boolean {
  const rel = nodePath.relative(nodePath.resolve(root), nodePath.resolve(file));
  return !!rel && !rel.startsWith("..") && !nodePath.isAbsolute(rel);
}

// dir ends with a slash, as do the roots it is called with
async function* walkDir(dir: string): AsyncGenerator<{ filePath: string; name: string }> {
  const entries = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      entries.push({ filePath: dir + entry.name, name: entry.name, isDir: entry.isDirectory });
    }
  } catch { return; }
  entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
  for (const entry of entries) {
    if (entry.isDir) yield* walkDir(entry.filePath + "/");
    else yield { filePath: entry.filePath, name: entry.name };
  }
}

// deno-lint-ignore no-explicit-any
export default async function (node: Node, vars: any = {}): Promise<HtmlString> {
  const ctx = getCtx();
  if (!ctx.user?.superuser) throw new Output("Access denied", { status: 403 });

  const customPath = node.module?.data ?? "";
  const modPath = node.module?.dir ?? "";
  const root = vars.param?.in === "app" ? modPath : customPath;

  if (vars.param?.delete) {
    const file = String(vars.param.delete);
    if (!root || !inRoot(file, root)) throw new Output("invalid path", { status: 400 });
    try { await Deno.remove(file); } catch { /* ignore */ }
  }
  if (vars.param?.create) {
    if (!root || typeof vars.param.create !== "string") throw new Output("invalid path", { status: 400 });
    const file = nodePath.resolve(root, vars.param.create);
    if (!inRoot(file, root)) throw new Output("invalid path", { status: 400 });
    try { await Deno.mkdir(nodePath.dirname(file), { recursive: true }); } catch { /* ignore */ }
    try { await Deno.writeTextFile(file, ""); } catch { /* ignore */ }
  }

  const fileRow = (filePath: string, base: number, info: Deno.FileInfo): HtmlString => {
    const url = editorUrl(filePath);
    const name = filePath.slice(base);
    return html`<tr itemid="${filePath}">
      <td>${url ? html`<a href="${url}" target="${encodeURIComponent(filePath)}">${name}</a>` : name}
      <td>${new Date(info.mtime ?? 0).toLocaleDateString()}
      <td class=-remove style="cursor:pointer;padding-left:0">
        <img src="${ctx.req.moduleUrl}cms.frontend.4/pub/img/delete.svg" alt=delete>`;
  };

  const customFiles = [];
  for await (const { filePath } of walkDir(customPath)) {
    const info = await Deno.stat(filePath).catch(() => null);
    if (!info?.isFile) continue;
    customFiles.push(fileRow(filePath, customPath.length, info));
  }

  const appFiles = [];
  for await (const { filePath } of walkDir(modPath ?? "")) {
    const info = await Deno.stat(filePath).catch(() => null);
    if (!info?.isFile) continue;
    appFiles.push(fileRow(filePath, modPath?.length ?? 0, info));
  }

  const module = node.vs.module;
  let globalSettings: HtmlString | string = "";
  if (module && module in node.app.settings) {
    // SettingsEditor.mjs is loaded by panel.mjs
    globalSettings = html`<div class="-widgetHead -open" tabindex=0><span class=-title>Global Settings</span></div>
    <div class=-content><settings-editor source="/api/core/settings/${module}"></settings-editor></div>`;
  }

  return html`
  <div class=superuser-manager pid=${node.id} style="display:flex;flex-flow:wrap;margin:-.125rem;">
    <div scope=custom style="margin:.125rem;flex:1 1 auto">
      <div class="-widgetHead -open">Custom Files</div>
      <div class=-content>
        <table class=-styled style="width:100%">
          <th colspan=3><input class=-create placeholder=create style="width:100%">
          ${customFiles}
        </table>
      </div>
    </div>
    <div scope=app style="margin:.125rem;flex:1 1 auto">
      <div class="-widgetHead -open">App Files</div>
      <div class=-content>
        <table class=-styled style="width:100%">
          <tr><th colspan=3><input class=-create placeholder=create style="width:100%">
          ${appFiles}
        </table>
      </div>
    </div>
  </div>
  ${globalSettings}`;
}
