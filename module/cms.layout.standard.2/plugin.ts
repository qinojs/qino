import { hee } from "@qino/qino";
import { cms as cmsOf, WRITE } from "@qino/qino/cms";
import { moduleTemplate } from "@qino/qino/cms.templateParser";
import { editorUrl } from "@qino/qino/fileEditor";
import * as u2 from "@qino/qino/u2";

import { codeFiles } from "./codeFiles.ts";

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export { api } from "./api.ts";

// Pinned on purpose: the site's css is written against it, so a CMS update cannot change its look.
// The site moves on in the panel (u2Version on the global layout page), once its css is checked.
const U2_VERSION = "1.6.0";

/** The u2 release the layout loads: its global layout page's, else the pin. */
const u2Version = (layout: Node) => {
  const version = String(layout.settings.u2Version() ?? "");
  return /^\d+\.\d+\.\d+$/.test(version) ? version : U2_VERSION;
};

const U2_ASSETS = [
  "css/norm/norm.css", "css/base/base.css", "css/base/print.css", "css/base/nomotion.css",
  "css/classless/variables.css", "css/classless/classless.css", "css/classless/more.css",
  "class/width/width.css", "class/flex/flex.css", "u2/auto.js",
];

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");
  if (await node.edit()) await codeFiles(node).create();

  const version = u2Version(await node.cms.layoutPage(node.module!.name));
  u2.assets(ctx, U2_ASSETS, version);
  ctx.res.html.importMap.set("@u2/", u2.root(version)); // contents import the page's u2 from here
  ctx.res.html.inlineStyles.add(await u2.identityCss(node.app));

  // The template decides whether and how main exists; the starter only fills a flexible it just created.
  const template = moduleTemplate(node.module!);
  const fresh = !(await node.conts()).some((c) => c.vs.name === "main");
  const out = await template.render(node);
  return fresh && await starter(node) ? template.render(node) : out;
}

/** A new main starts with a section whose text holds an editable h1; an emptied main stays empty. */
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

/** The global layout page for the panel: its id (for its settings), the u2 release and the file
 *  editor links; editor URLs are session capabilities. Only for who may write it. */
const panelApi = async (node: Node, vars: Record<string, unknown>) => {
  if (vars.do !== "getLayout" && vars.do !== "openFile") return;
  const layout = await node.cms.layoutPage(node.module!.name);
  if (await layout.access() < WRITE) return;
  const files = codeFiles(node);
  if (vars.do === "openFile") return (vars.key === "html" || vars.key === "css") && await files.open(vars.key);
  return {
    id: layout.id, u2Version: layout.settings.u2Version() ?? "", u2Default: U2_VERSION,
    files: (["html", "css"] as const)
      .map((key) => ({ key, name: files[key].split("/").pop()!, url: editorUrl(files[key]) })).filter((f) => f.url),
  };
};

/** The designer agent (agents/designer.md) learns which u2 release the site loads. */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const name = "cms.layout.standard.2";
  app.on("ai1.agent:turn", async (turn: { agent: number; parts: string[] }) => {
    if (await app.db.one`SELECT name FROM ai1_agent WHERE id = ${turn.agent}` !== `${name}/designer`) return;
    const version = u2Version(await cmsOf(app).layoutPage(name));
    turn.parts.push(`## u2\nThis site loads u2 ${version}. Its index: ${u2.root(version)}SKILL.md`);
  }, { signal });
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    widget: "pub/widget.js",
    api: panelApi,
  },
};
