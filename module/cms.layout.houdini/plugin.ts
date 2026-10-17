import { getCtx, hee } from "@qino/qino";
import { WRITE } from "@qino/qino/cms";
import { moduleTemplate } from "@qino/qino/cms.templateParser";
import { editorUrl } from "@qino/qino/fileEditor";
import * as u2 from "@qino/qino/u2";

import { codeFiles } from "./codeFiles.ts";
import { themeCss } from "./pub/theme.js";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export { api } from "./api.ts";

export const templatePlaceholders = {
  home: () => {
    const ctx = getCtx();
    return { text: ctx.req.appUrl + (ctx.lang ? encodeURIComponent(ctx.lang) + "/" : "") };
  },
};

// The site can move its release after checking its own template and CSS.
const U2_VERSION = "1.8.0";
const U2_ASSETS = [
  "css/norm/norm.css", "css/base/base.css", "css/base/print.css", "css/base/nomotion.css",
  "css/classless/variables.css", "css/classless/classless.css", "css/classless/more.css",
  "class/width/width.css", "class/grid/grid.css", "u2/auto.js",
  "el/responsive/responsive.css", "el/responsive/responsive.js",
];

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const layout = await node.cms.layoutPage(node.module!.name);
  const version = String(layout.settings.u2Version() ?? "");
  u2.pin(ctx, /^\d+\.\d+\.\d+$/.test(version) ? version : U2_VERSION);
  u2.assets(ctx, U2_ASSETS);
  // CMS adds layout styles before render. Keep u2 first so content modules can override our low-specificity defaults.
  const styles = ctx.res.html.styles;
  const mainCss = node.module!.modUrl + "pub/main.css";
  if (styles.delete(mainCss)) styles.add(mainCss);
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");
  for (const css of [await u2.identityCss(node.app), themeCss(layout.settings.design())])
    if (css) ctx.res.html.inlineStyles.add(css);
  if (await node.edit()) await codeFiles(node).create();

  const template = moduleTemplate(node.module!);
  const fresh = !(await node.conts()).some((c) => c.vs.name === "main");
  const out = await template.render(node);
  const result = fresh && await starter(node) ? await template.render(node) : out;
  const siteCss = node.module!.dataUrl + "pub/main.css";
  if (styles.delete(siteCss)) styles.add(siteCss);
  return result;
}

/** Only a newly declared flexible main receives an editable title; deliberate empty content stays empty. */
async function starter(page: Node) {
  const main = (await page.conts()).find((c) => c.vs.name === "main");
  if (main?.vs.module !== "cms.cont.flexible" || (await main.conts()).length) return false;
  await page.app.db.transaction(async () => {
    await main.settings.__inited(true);
    const section = await main.createCont({ module: "cms.cont.section" });
    const text = await section.cont("main", "cms.cont.text");
    for (const lang of page.app.languages.all)
      await text.text("main", lang, `<h1>${hee((await page.showTitle(lang)).plain())}</h1>`);
  });
  return true;
}

/** Global layout access governs both the visual editor and the shared template files. */
const panelApi = async (node: Node, vars: Record<string, unknown>) => {
  if (vars.do !== "getLayout" && vars.do !== "openFile") return;
  const layout = await node.cms.layoutPage(node.module!.name);
  if (await layout.access() < WRITE) return;
  const files = codeFiles(node);
  if (vars.do === "openFile") return (vars.key === "html" || vars.key === "css") && await files.open(vars.key);
  return {
    id: layout.id, module: node.module!.name, design: layout.settings.design() ?? {},
    u2Version: layout.settings.u2Version() ?? "", u2Default: U2_VERSION,
    files: (["html", "css"] as const)
      .map((key) => ({ key, name: files[key].split("/").pop()!, url: editorUrl(files[key]) })).filter((f) => f.url),
  };
};

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    widget: "pub/widget.js",
    api: panelApi,
  },
};
