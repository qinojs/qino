import type { App } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";
import { loadTemplate, renderTemplateFile } from "./mod.ts";

export const name = "cms.templateParser";
export const description = "Renders declarative HTML templates with editable CMS fields and content.";
export const needs = ["cms", "cms.image2"];

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("node:render", async (e) => {
    const dir = e.node.module?.dir;
    if (!dir) return;
    const path = dir + "template.html";
    if (!await loadTemplate(path)) return; // no template.html — module renders itself
    e.render = (node: Node) => renderTemplateFile(path, node);
  }, { signal });
}
