import type { Node } from "../cms/mod.ts";
import type { RequestContext } from "../core/mod.ts";

export const name = "cms.cont.nav3";

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

async function render(node: Node, { ctx }: { ctx: RequestContext }): Promise<string> {
  const cms = node.cms;
  const settings = node.settings;

  // Determine active page
  const activeByRenderPath = await settings["active page by renderpath"];
  let ActivePage: Node;
  if (activeByRenderPath) {
    const firstId = ctx.cms.renderPath.values().next().value;
    const firstPage = firstId ? await cms.node(firstId) : null;
    ActivePage = firstPage ? await firstPage.page() : ctx.cms.mainNode;
  } else {
    ActivePage = ctx.cms.mainNode;
  }

  // Determine start page
  const startPageSetting = settings.startPage();
  const startLevelSetting = settings.startLevel();

  let StartPage: Node | undefined;
  if (startPageSetting) {
    StartPage = await cms.node(Number(startPageSetting));
    if (!StartPage.is()) StartPage = await node.page();
  } else {
    StartPage = await node.page();
  }

  if (startLevelSetting) {
    StartPage = await ActivePage.parent(Number(startLevelSetting));
    if (!StartPage || !(await StartPage.is())) {
      StartPage = await node.page();
    }
  }

  // Settings for rendering
  const filterVisible = settings.filter_visible();
  const levelLimitSetting = settings.level();
  const pathOnly = settings.pathOnly();
  const includeContentsSetting = await settings["include contents"];

  let level = 0;

  const getUl = async (CurPage: Node): Promise<string | false> => {
    if (!CurPage || !(await CurPage.is())) return "";

    // Collect children
    const readableChildren: Node[] = [];
    const allChildren = await CurPage.children("readable");
    for (const C of allChildren.values()) {
      if (filterVisible === "visible" && !C.vs.visible) continue;
      if (filterVisible === "hidden" && C.vs.visible) continue;
      readableChildren.push(C);
    }

    // Optionally include content items (contents of children)
    if (includeContentsSetting) {
      const conts = await CurPage.conts();
      for (const FirstLevelCont of conts) {
        const bough = await FirstLevelCont.bough(["readable", { type: "c" }]);
        for (const Content of bough.values()) {
          if (Content.vs.visible) readableChildren.push(Content);
        }
      }
    }

    // Filter: skip entries without a title
    const filtered: Node[] = [];
    for (const C of readableChildren) {
      const titleObj = await C.title();
      if (titleObj && (await titleObj.string()).trim()) filtered.push(C);
    }

    if (!filtered.length) return false;

    const levelLimit = Number(levelLimitSetting || 0);
    if (levelLimit && level >= levelLimit) return "";

    if (pathOnly && level > 0 && !(await ActivePage?.in(CurPage))) return "";

    level++;
    let str = `<ul class="cmsChilds${CurPage}">`;
    for (const ChildPage of filtered) {
      const childStr = await getUl(ChildPage);

      const childPage = await ChildPage.page();
      const isInside = ActivePage ? await ActivePage.in(childPage) : false;
      const isActive = ActivePage === childPage;
      const hasSub = childStr !== false;
      const isOnline = await ChildPage.isOnline();

      const cls = [
        "cmsLink" + ChildPage,
        isInside ? "cmsInside" : "",
        isActive ? "cmsActive" : "",
        hasSub ? "cmsHasSub" : "",
        !isOnline ? "cmsOffline" : "",
      ].filter(Boolean).join(" ");

      str += `<li class="${cls}">${await cms.link(ChildPage)}${childStr || ""}`;
    }
    str += "</ul>";
    level--;
    return str;
  };

  const nav = await getUl(StartPage);
  return `<nav>${nav || ""}</nav>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
