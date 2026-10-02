import { hee } from "@qino/qino";
import { WRITE } from "@qino/qino/cms";
import { loadTemplate, renderTemplateFile } from "@qino/qino/cms.templateParser";
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
  const files = codeFiles(node);
  if (await node.edit()) await files.create();

  // CMS has already registered the layout/site CSS; insert both after u2.
  u2.assets(ctx, U2_ASSETS);
  ctx.res.html.inlineStyles.add(await u2.identityCss(node.app));
  await files.addAssets();

  await initialize(node, files);
  return await renderTemplateFile(files.src, node) ?? await renderTemplateFile(files.shipped, node) ?? "<div></div>";
}

async function initialize(node: Node, files: ReturnType<typeof codeFiles>) {
  // Only initialize starting points declared by the selected template.
  const pending = [...(await loadTemplate(files.src) ?? await loadTemplate(files.shipped) ?? [])].reverse();
  const mains = new Set<Node>();
  const seen = new Set<Node>();
  let nav = false, seenNav = false;
  while (pending.length) {
    const el = pending.pop()!;
    if (el.type !== "element") continue;
    const attrs = Object.fromEntries(el.attrs.map(({ name, value }) => [name, value]));
    if (el.tag === "cms-image" || attrs["cms-text"]) continue;
    if (el.tag !== "cms-cont") {
      pending.push(...el.children.toReversed());
      continue;
    }
    const module = attrs.module !== undefined ? attrs.module ?? ""
      : attrs["default-module"] !== undefined ? attrs["default-module"] ?? "" : "cms.cont.flexible";
    if (attrs.name === "nav" && attrs.node === "layout" && !seenNav) {
      seenNav = true;
      nav = module === "cms.cont.nav4";
    }
    if (attrs.name !== "main") continue;
    const target = attrs.node === undefined ? node : attrs.node === "page" ? await node.page() : undefined;
    if (!target || seen.has(target)) continue;
    seen.add(target);
    if (module === "cms.cont.flexible") mains.add(target);
  }
  if (!nav && !mains.size) return;
  await node.app.db.transaction(async () => {
    const module = (await node.page()).module;
    if (nav && module) {
      const layout = await node.cms.layoutPage(module.name);
      await layout.cont("nav", { module: "cms.cont.nav4", settings: { pathOnly: true } });
    }
    for (const target of mains) {
      if ((await target.conts()).some((c) => c.vs.name === "main")) continue;
      const main = await target.cont("main", { module: "cms.cont.flexible", settings: { __inited: true } });
      const section = await main.createCont({ module: "cms.cont.section" });
      const text = await section.cont("main", "cms.cont.text");
      for (const lang of node.app.languages.all)
        await text.text("main", lang, `<h1>${hee((await target.showTitle(lang)).plain())}</h1>`);
    }
  });
}

/** Editor URLs are session capabilities; the global layout page decides access. */
const panelApi = async (node: Node, vars: Record<string, unknown>) => {
  if (vars.do !== "getFileEditorLinks") return;
  const layout = await node.cms.layoutPage(node.module!.name);
  if (await layout.access() < WRITE) return [];
  const files = codeFiles(node);
  return (["src", "css", "js"] as const)
    .map((key) => ({ key: key === "src" ? "html" : key, name: files[key].split("/").pop()!, url: editorUrl(files[key]) })).filter((f) => f.url);
};

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    widget: "pub/widget.js",
    api: panelApi,
  },
};
