import { hee, html } from "@qino/qino";

import manifest from "./manifest.json" with { type: "json" };

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

// One font per site, not per page: app settings, not node settings.
export const settingsSchema = {
  properties: {
    "font-css-file": { type: "string", description: "URL or path to an additional CSS file included before the custom layout." },
  },
};

async function render(node: Node, data: { ctx: Ctx }): Promise<string | HtmlString> {
  const module = node.module!;

  // Font CSS from layout settings
  const fontCss = String(await node.app.settings[name]["font-css-file"] ?? "");
  if (fontCss) {
    data.ctx.res.html.head += `<link rel=stylesheet href="${
      hee(fontCss.replace(/\|/g, "%7C"))
    }">\n`;
  }

  // Delegate to app-specific layout override: data/<module>/index.ts
  const customPath = module.data + "index.ts";
  try {
    await Deno.stat(customPath);
    const mod = await import(customPath);
    if (typeof mod.default === "function") return mod.default(node, data);
  } catch { /* no custom layout override */ }

  // Fallback: basic layout
  return html.async`<div id=container><main>${node.cont("main")}</main></div>`;
}

export const cms = {
  node: {
    render,
  },
};
