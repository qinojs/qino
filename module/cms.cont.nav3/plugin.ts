import { cmsCtx, type Node } from "../cms/mod.ts";
import type { Ctx } from "../core/mod.ts";

export const name = "cms.cont.nav3";
export const description = "Configurable nested navigation from the CMS page tree.";

const settingsSchema = {
  properties: {
    "active page by renderpath": {
      type: "boolean",
      description: "Determines the active page from the render path instead of the main page of the current content.",
    },
    startPage: {
      type: "integer", minimum: 1,
      description: "Page ID from which the navigation is built. Leave empty for the current page.",
      "x-html": { type: "qgcms-page" }
    },
    startLevel: {
      type: "integer", minimum: 0,
      description: "Starts navigation at a parent level of the active page. Overrides startPage when set.",
    },
    filter_visible: {
      enum: ["", "visible", "hidden"],
      description: "Filters navigation items by visibility: empty shows all readable pages, visible only visible ones, hidden only hidden ones.",
    },
    level: {
      type: "integer", minimum: 0,
      description: "Maximum depth of the navigation. 0 or empty means no explicit depth limit.",
    },
    pathOnly: {
      type: "boolean",
      description: "Shows sub-levels only along the active path.",
    },
    "include contents": {
      type: "boolean",
      description: "Includes visible content elements of pages as navigation items.",
    },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<string> {
  const cms = node.cms;
  const settings = node.settings;

  // Determine active page
  const activeByRenderPath = await settings["active page by renderpath"];
  let activePage: Node;
  if (activeByRenderPath) {
    const firstId = cmsCtx(ctx).renderPath.values().next().value;
    const firstPage = firstId ? await cms.node(firstId) : null;
    activePage = firstPage ? await firstPage.page() : cmsCtx(ctx).mainNode;
  } else {
    activePage = cmsCtx(ctx).mainNode;
  }

  // Determine start page
  const startPageSetting = settings.startPage();
  const startLevelSetting = settings.startLevel();

  let startPage: Node | undefined;
  if (startPageSetting) {
    startPage = await cms.node(Number(startPageSetting));
    if (!startPage.exists()) startPage = await node.page();
  } else {
    startPage = await node.page();
  }

  if (startLevelSetting) {
    startPage = await activePage.parent(Number(startLevelSetting));
    if (!startPage || !startPage.exists()) startPage = await node.page();
  }

  // Settings for rendering
  const filterVisible = settings.filter_visible();
  const levelLimitSetting = settings.level();
  const pathOnly = settings.pathOnly();
  const includeContentsSetting = await settings["include contents"];

  let level = 0;

  const getUl = async (curPage: Node): Promise<string | undefined> => {
    if (!curPage.exists()) return "";

    // Collect children
    const readableChildren: Node[] = [];
    const allChildren = await curPage.children("readable");
    for (const child of allChildren.values()) {
      if (filterVisible === "visible" && !child.vs.visible) continue;
      if (filterVisible === "hidden" && child.vs.visible) continue;
      readableChildren.push(child);
    }

    // Optionally include content items (contents of children)
    if (includeContentsSetting) {
      const conts = await curPage.conts();
      for (const cont of conts) {
        const bough = await cont.bough(["readable", { type: "c" }]);
        for (const sub of bough.values()) {
          if (sub.vs.visible) readableChildren.push(sub);
        }
      }
    }

    // Filter: skip entries without a title
    const filtered: Node[] = [];
    for (const child of readableChildren) {
      const titleObj = await child.title();
      if (titleObj && (await titleObj.string()).trim()) filtered.push(child);
    }

    if (!filtered.length) return;

    const levelLimit = Number(levelLimitSetting || 0);
    if (levelLimit && level >= levelLimit) return "";

    if (pathOnly && level > 0 && !(await activePage.in(curPage))) return "";

    level++;
    let str = `<ul class="cmsChilds${curPage}">`;
    for (const child of filtered) {
      const childStr = await getUl(child);

      const childPage = await child.page();
      const isInside = await activePage.in(childPage);
      const isActive = activePage === childPage;
      const hasSub = childStr !== undefined;
      const isOnline = await child.isOnline();

      const cls = [
        "cmsLink" + child,
        isInside ? "cmsInside" : "",
        isActive ? "cmsActive" : "",
        hasSub ? "cmsHasSub" : "",
        !isOnline ? "cmsOffline" : "",
      ].filter(Boolean).join(" ");

      str += `<li class="${cls}">${await cms.link(child)}${childStr || ""}`;
    }
    str += "</ul>";
    level--;
    return str;
  };

  return `<nav>${await getUl(startPage) || ""}</nav>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
