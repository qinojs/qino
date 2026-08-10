import type { Ctx, HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { siteTemplate } from "../lib/siteTemplate.ts";

export const name = "cms.cont.cd.services_links";
export const description = "Legacy link list; the links themselves are site data.";
export const needs = ["cms"];

// The PHP module carried the markup with hardcoded page ids and labels — that is one site's
// content, so it lives in data/<module>/index.ts here.
async function render(node: Node, data: { ctx: Ctx }): Promise<HtmlString | string> {
  return await siteTemplate(node, data) ?? "";
}

export const cms = {
  node: {
    render,
  },
};
