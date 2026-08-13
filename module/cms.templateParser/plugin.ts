import { loadTemplate } from "./mod.ts";
import { renderNodes } from "./render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("node:render", async (e) => {
    const mod = e.node.module;
    if (!mod) return;
    const ast = await loadTemplate(new URL("template.html", mod.source));
    if (!ast) return; // no template.html — module renders itself
    e.render = (node: Node) => renderNodes(ast, node);
  }, { signal });
}
