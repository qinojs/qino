import type { App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { loadTemplate } from "./mod.ts";
import { renderNodes } from "./render.ts";

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("node:render", async (e) => {
    const mod = e.node.module;
    if (!mod) return;
    const ast = await loadTemplate(new URL("template.html", mod.source));
    if (!ast) return; // no template.html — module renders itself
    e.render = (node: Node) => renderNodes(ast, node);
  }, { signal });
}
