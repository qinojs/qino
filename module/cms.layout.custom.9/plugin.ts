import { hee } from "../core/mod.ts";
import type { CMS } from "../cms/mod.ts";
import type { Node } from "../cms/mod.ts";
import type { RequestContext } from "../core/mod.ts";

export const name = "cms.layout.custom.9";

const settingsSchema = {
  properties: {
    "font-css-file": { type: "string", description: "URL or path to an additional CSS file included before the custom layout." },
  },
};

async function render(node: Node, data: { ctx: RequestContext }): Promise<string> {
  const module = node.vs.module;
  const LPage = await getLayoutPage(node.cms, String(module));

  // App-specific layout CSS
  try {
    await Deno.stat(node.app.appPATH + "qg/" + module + "/pub/main.css");
    data.ctx.html.styles.add(data.ctx.appURL + "qg/" + module + "/pub/main.css");
  } catch {/**/}

  // Font CSS from layout settings
  const fontCss = LPage.settings["font-css-file"]();
  if (fontCss) {
    data.ctx.html.head += `<link rel=stylesheet href="${
      hee(fontCss.replace(/\|/g, "%7C"))
    }">\n`;
  }

  // Delegate to app-specific layout override: qg/<module>/index.ts
  const customPath = node.app.appPATH + "qg/" + module + "/index.ts";
  try {
    await Deno.stat(customPath);
    const mod = await import(customPath);
    if (typeof mod.default === "function") {
      return mod.default(node, { LPage, ...data });
    }
  } catch { /* no custom layout override */ }

  // Fallback: basic layout
  const mainCont = await node.cont("main");
  return `<div id=container><main>${await mainCont.html()}</main></div>`;
}

async function getLayoutPage(cms: CMS, module: string): Promise<Node> {
  const sysPage = await cms.node(5);
  const children = await sysPage.children({ module });
  let LPage = children.values().next().value;
  if (!LPage) {
    LPage = await sysPage.createChild({ module, name: module, access: 1 });
    await LPage.title(undefined, module);
  }
  return LPage;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
