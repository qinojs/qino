import { hee } from "@qino/qino";
import { cmsCtx } from "@qino/qino/cms";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    startPage: {
      type: "integer", minimum: 1,
      description: "Parent of the navigation entries. Defaults to the current page's tree root.",
      "x-html": { type: "qgcms-page" },
    },
    startLevel: {
      type: "integer", minimum: 0,
      description: "Absolute level in the current page's path, starting at 0. Overrides startPage.",
    },
    filter_visible: {
      enum: ["", "visible", "hidden"], default: "visible",
      description: "Visible pages by default; hidden selects hidden pages, empty selects all readable pages.",
    },
    level: {
      type: "integer", minimum: 0,
      description: "Maximum number of list levels. Empty or 0 means unlimited.",
    },
    pathOnly: {
      type: "boolean",
      description: "Expand sub-levels only along the current page's path.",
    },
    "include contents": {
      type: "boolean",
      description: "Also list visible, readable content anchors of each page.",
    },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const settings = node.settings;
  const activePage = await (cmsCtx(ctx).mainNode ?? await node.page()).page();
  const path = await activePage.path();
  const root = path.values().next().value ?? activePage;
  const startPage = settings.startPage<number>();
  const startLevel = settings.startLevel<number>();
  const visibility = settings.filter_visible<string>();
  const limit = settings.level<number>();
  const pathOnly = settings.pathOnly<boolean>();
  const includeContents = settings["include contents"]<boolean>();

  let start = root;
  if (Number.isSafeInteger(startLevel) && startLevel >= 0) {
    start = [...path.values()][startLevel] ?? root;
  } else if (Number.isSafeInteger(startPage) && startPage > 0) {
    start = (await node.cms.node(startPage)).exists() ?? root;
  }

  // children come readable already, so only the start page is checked
  async function list(page: Node, depth = 0): Promise<string> {
    if (limit && depth >= limit || pathOnly && depth && !path.has(page.id)) return "";
    const children = [...(await page.children(["readable", {
      visible: visibility ? visibility === "visible" : undefined,
    }])).values()];
    if (includeContents && page.vs.type === "p") {
      for (const cont of await page.conts())
        children.push(...(await cont.bough(["readable", { type: "c", visible: true }])).values());
    }
    // the link itself carries href, aria-current, cmsLink<ID> and cmsOffline
    const items = await Promise.all(children.map(async (child) => {
      if (!(await child.showTitle()).plain()) return "";
      const sub = child.vs.type === "p" ? await list(child, depth + 1) : "";
      const classes = [
        path.has(child.id) ? "cmsInside" : "",
        child.id === activePage.id ? "cmsActive" : "",
        sub ? "cmsHasSub" : "",
      ].filter(Boolean).join(" ");
      return `<li${classes ? ` class="${classes}"` : ""}>${await node.cms.link(child)}${sub}</li>`;
    }));
    const out = items.join("");
    return out ? `<ul>${out}</ul>` : "";
  }

  const out = await start.isReadable() ? await list(start) : "";
  if (!out) return "<span></span>"; // no empty landmark
  const label = (await node.showTitle()).plain();
  return `<nav${label ? ` aria-label="${hee(label)}"` : ""}>${out}</nav>`;
}

export const cms = { node: { render, settingsSchema } };
