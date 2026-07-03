import type { App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { parseTemplate, type TNode } from "./parse.ts";
import { renderNodes } from "./render.ts";

export const name = "cms.templateParser";
export const needs = ["cms", "cms.image2"];

// parsed templates keyed by file path — derived from the file only, safe to share across apps
const cache = new Map<string, TNode[]>();
const watching = new Set<string>();

function watchTemplate(path: string): void {
  if (watching.has(path)) return;
  watching.add(path);
  (async () => {
    for await (const event of Deno.watchFs(path)) {
      if (event.kind === "modify" || event.kind === "create" || event.kind === "remove") cache.delete(path);
    }
  })().catch(() => watching.delete(path));
}

export function init(app: App) {
  app.on("cms.node.render", async (e) => {
    const dir = e.node.module?.dir;
    if (!dir) return;
    const path = dir + "template.html";
    let ast = cache.get(path);
    if (!ast) {
      let source: string;
      try { source = await Deno.readTextFile(path); }
      catch { return; } // no template.html — module renders itself
      cache.set(path, ast = parseTemplate(source));
      if (app.dev) watchTemplate(path);
    }
    const tpl = ast;
    e.render = (node: Node) => renderNodes(tpl, node);
  });
}
