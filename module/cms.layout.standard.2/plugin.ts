import { hee } from "@qino/qino";
import { WRITE } from "@qino/qino/cms";
import { moduleTemplate } from "@qino/qino/cms.templateParser";
import { editorUrl } from "@qino/qino/fileEditor";
import * as u2 from "@qino/qino/u2";

import { codeFiles } from "./codeFiles.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export { api } from "./api.ts";

const U2_ASSETS = [
  "css/norm/norm.css", "css/base/base.css", "css/base/print.css", "css/base/nomotion.css",
  "css/classless/variables.css", "css/classless/classless.css", "css/classless/more.css",
  "class/width/width.css", "class/flex/flex.css", "u2/auto.js",
];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");
  if (await node.edit()) await codeFiles(node).create();

  u2.assets(ctx, U2_ASSETS);
  ctx.res.html.inlineStyles.add(await u2.identityCss(node.app));

  // The template decides whether and how main exists; the starter only fills a flexible it just created.
  const template = moduleTemplate(node.module!);
  const fresh = !(await node.conts()).some((c) => c.vs.name === "main");
  const out = await template.render(node);
  return fresh && await starter(node) ? template.render(node) : out;
}

/** A new main starts with a section whose text holds an editable h1; an emptied main stays empty. */
async function starter(page: Node): Promise<boolean> {
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

/** Editor URLs are session capabilities; the global layout page decides access. */
const panelApi = async (node: Node, vars: Record<string, unknown>) => {
  if (vars.do !== "getFileEditorLinks" && vars.do !== "openFile") return;
  const layout = await node.cms.layoutPage(node.module!.name);
  if (await layout.access() < WRITE) return [];
  const files = codeFiles(node);
  if (vars.do === "openFile") return (vars.key === "html" || vars.key === "css") && await files.open(vars.key);
  return (["html", "css"] as const)
    .map((key) => ({ key, name: files[key].split("/").pop()!, url: editorUrl(files[key]) })).filter((f) => f.url);
};

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    widget: "pub/widget.js",
    api: panelApi,
  },
};
