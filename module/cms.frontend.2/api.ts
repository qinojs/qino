// deno-lint-ignore-file no-explicit-any

import { getCtx, hee } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

function widgetUrl(widget: string): string {
  return new URL("./view/widgets/" + widget + ".ts", import.meta.url).href;
}

/** Render widget content */
export async function cmsFrontend2Widget(
  widget: string,
  open: boolean,
  node: Node,
  cls = "-content",
  param: Record<string, any> = {},
): Promise<string> {
  let inner = "";
  if (open) {
    const mod = await import(widgetUrl(widget));
    inner = String(await mod.default?.(node, { param }) ?? "");
  }
  return `<div class="${cls}" widget=${widget}>${inner}</div>`;
}

/** Widget als Accordion */
export async function cmsFrontend2WidgetAccordion(
  widget: string,
  node: Node,
  title: string | null = null,
  param: Record<string, any> = {},
): Promise<string> {
  const ctx = getCtx();

  const open = !!await ctx.settings["cms.frontend.2"].custom.widget[widget];
  const cls = "-widgetHead " + (open ? "-open" : "");

  let headHtml: string;
  try {
    headHtml = await cmsFrontend2Widget(widget + ".head", true, node, cls, param);
  } catch {
    headHtml = `<div class="${cls}"><span class=-title>${
      title ?? widget
    }</span></div>`;
  }
  const contentHtml = await cmsFrontend2Widget(widget, open, node, "-content", param);
  return headHtml + contentHtml;
}

/** Widget als Sidebar-Item */
export async function cmsFrontend2WidgetSidebar(widget: string, node: Node, title: string, tooltip = ""): Promise<string> {
  const ctx = getCtx();
  const sidebarV = await ctx.settings["cms.frontend.2"].custom.sidebar;
  const open = sidebarV === widget;
  const content = await cmsFrontend2Widget(widget, open, node);
  return `<div class="-item ${open ? "-open" : ""}" itemid="${widget}">
  ${content}
  <div class=-title>
    <div class=-text title="${hee(tooltip)}">${title}</div>
  </div>
</div>`;
}
