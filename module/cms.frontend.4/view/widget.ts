// deno-lint-ignore-file no-explicit-any
import { getCtx, hee } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

export function widgetUrl(widget: string): string {
  return new URL("./widgets/" + widget + ".ts", import.meta.url).href;
}

/** Render widget content */
export async function widget(
  name: string,
  open: boolean,
  node: Node,
  cls = "-content",
  param: Record<string, any> = {},
): Promise<string> {
  let inner = "";
  if (open) {
    // a widget without a server renderer is a client widget: leave the container empty for it
    const mod = await import(widgetUrl(name)).catch(() => null);
    inner = String(await mod?.default?.(node, { param }) ?? "");
  }
  return `<div class="${cls}" widget=${name}>${inner}</div>`;
}

/** Widget as a sidebar item. */
export async function sidebar(name: string, node: Node, title: string, tooltip = ""): Promise<string> {
  const ctx = getCtx();
  const sidebarV = await ctx.settings["cms.frontend.4"].ui.sidebar;
  const open = sidebarV === name;
  const content = await widget(name, open, node);
  return `<div class="-item ${open ? "-open" : ""}" itemid="${name}">
  ${content}
  <div class=-title>
    <div class=-text title="${hee(tooltip)}">${title}</div>
  </div>
</div>`;
}
