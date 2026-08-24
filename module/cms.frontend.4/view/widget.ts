// deno-lint-ignore-file no-explicit-any
import { getCtx, hee, html } from "@qino/qino";
import { ADMIN } from "@qino/qino/cms";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function widgetUrl(widget: string): string {
  return new URL("./widgets/" + widget + ".ts", import.meta.url).href;
}

// Adding/assigning a module = ADMIN ("insertable") on the module axis — edit-only groups don't see it.
// cms.accessRules lowers e.access to the user's module cap; without it everything stays insertable.
export const moduleAccess = (node: Node, module: string): Promise<number> =>
  node.app.fire("module:access", { module, user: getCtx().user, access: ADMIN }).then((e) => Number(e.access));

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

/** Widget as an accordion. Without a `<name>.head` renderer the plain title is shown. */
export async function accordion(
  name: string,
  node: Node,
  title: string | null = null,
  param: Record<string, any> = {},
): Promise<string> {
  const ctx = getCtx();

  const open = !!await ctx.settings["cms.frontend.4"].ui.widget[name];
  const cls = "-widgetHead " + (open ? "-open" : "");

  const headMod = await import(widgetUrl(name + ".head")).catch(() => null);
  const headHtml = headMod
    ? `<div class="${cls}">${String(await headMod.default?.(node, { param }) ?? "")}</div>`
    : `<div class="${cls}"><span class=-title>${title ?? name}</span></div>`;
  return headHtml + await widget(name, open, node, "-content", param);
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
