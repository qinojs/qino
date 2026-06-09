import type { Node } from "../../../cms/mod.ts";
import { hee, getCtx } from "../../../core/mod.ts";

function moduleDir(node: Node): string | null {
  const path = node.app.modules.get(String(node.vs.module ?? ""))?.path;
  return path?.replace(/\/?(mod|plugin)\.[jt]s$/, "") ?? null;
}

async function* walkDir(dir: string): AsyncGenerator<{ filePath: string; name: string }> {
  const entries: { filePath: string; name: string; isDir: boolean }[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      entries.push({ filePath: dir + "/" + entry.name, name: entry.name, isDir: entry.isDirectory });
    }
  } catch { return; }
  entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
  for (const entry of entries) {
    if (entry.isDir) {
      yield* walkDir(entry.filePath);
    } else {
      yield { filePath: entry.filePath, name: entry.name };
    }
  }
}

export default async function (node: Node, vars: any = {}): Promise<string> {
  const ctx = getCtx();
  const app = node.app;

  if (vars.param?.delete) {
    try { await Deno.remove(vars.param.delete); } catch { /* egal */ }
  }
  if (vars.param?.create) {
    const root = vars.param.in === "app" ? (moduleDir(node) ?? "") + "/" : app.appPATH + "qg/" + node.vs.module + "/";
    const file = root + vars.param.create;
    try { await Deno.mkdir(file.replace(/\/[^/]+$/, ""), { recursive: true }); } catch { /* egal */ }
    try { await Deno.writeTextFile(file, ""); } catch { /* egal */ }
  }

  const customPath = app.appPATH + "qg/" + node.vs.module;
  let customFiles = "";
  for await (const { filePath } of walkDir(customPath)) {
    const info = await Deno.stat(filePath).catch(() => null);
    if (!info?.isFile) continue;
    const show = hee(filePath.slice(customPath.length + 1));
    const src = hee(ctx.appURL + "editor?file=" + encodeURIComponent(filePath));
    customFiles += `<tr itemid="${hee(filePath)}">
      <td><a href="${src}" target="${encodeURIComponent(filePath)}">${show}</a>
      <td>${new Date(info.mtime ?? 0).toLocaleDateString()}
      <td class=-remove style="cursor:pointer;padding-left:0">
        <img src="${ctx.sysURL}cms.frontend.2/pub/img/delete.svg" alt="delete">`;
  }

  let appFiles = "";
  const modPath = moduleDir(node);
  for await (const { filePath } of walkDir(modPath ?? "")) {
    const info = await Deno.stat(filePath).catch(() => null);
    if (!info?.isFile) continue;
    const show = hee(filePath.slice((modPath?.length ?? 0) + 1));
    const src = hee(ctx.appURL + "editor?file=" + encodeURIComponent(filePath));
    appFiles += `<tr itemid="${hee(filePath)}">
      <td><a href="${src}" target="${encodeURIComponent(filePath)}">${show}</a>
      <td>${new Date(info.mtime ?? 0).toLocaleDateString()}
      <td class=-remove style="cursor:pointer;padding-left:0">
        <img src="${ctx.sysURL}cms.frontend.2/pub/img/delete.svg" alt="delete">`;
  }

  const module = node.vs.module;
  let globalSettings = "";
  if (module && module in app.settings) {
    // SettingsEditor.mjs is loaded by panel.mjs
    globalSettings = `<div class="-widgetHead c1-focusIn -open" tabindex="0"><span class=-title>Global Settings</span></div>
    <div class=-content><settings-editor source="/api/core/settings/${hee(module)}"></settings-editor></div>`;
  }

  return `
  <div class=superuser-manager pid="${node}" style="display:flex;flex-flow:wrap;margin:-2px;">
    <div scope=custom style="margin:2px;flex:1 1 auto">
      <div class="-widgetHead c1-focusIn -open">Custom Files</div>
      <div class=-content>
        <table class=-styled style="width:100%">
          <th colspan=3><input class=-create placeholder=create style="width:100%">
          ${customFiles}
        </table>
      </div>
    </div>
    <div scope=app style="margin:2px;flex:1 1 auto">
      <div class="-widgetHead c1-focusIn -open">App Files</div>
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
