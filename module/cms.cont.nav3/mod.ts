// deno-lint-ignore-file no-explicit-any
// Port of cms.cont.nav3/index.php

import type { Node } from "../cms/lib/Node.ts";

export const name = "cms.cont.nav3";

const settingsSchema = {
  properties: {
    "active page by renderpath": {
      type: "boolean",
      description: "Bestimmt die aktive Seite aus dem Renderpfad statt aus der Hauptseite des aktuellen Inhalts.",
    },
    startPage: {
      type: "integer", minimum: 1,
      description: "Page-ID, ab der die Navigation aufgebaut wird. Leer lassen fuer die aktuelle Seite.",
      "x-html": { type: "qgcms-page" }
    },
    startLevel: {
      type: "integer", minimum: 0,
      description: "Startet die Navigation bei einem Eltern-Level der aktiven Seite. Ueberschreibt startPage, wenn gesetzt.",
    },
    filter_visible: {
      enum: ["", "visible", "hidden"],
      description: "Filtert Navigationspunkte nach Sichtbarkeit: leer zeigt alle lesbaren Seiten, visible nur sichtbare, hidden nur versteckte.",
    },
    level: {
      type: "integer", minimum: 0,
      description: "Maximale Tiefe der Navigation. 0 oder leer bedeutet ohne explizite Tiefenbegrenzung.",
    },
    pathOnly: {
      type: "boolean",
      description: "Zeigt Unterebenen nur entlang des aktiven Pfads.",
    },
    "include contents": {
      type: "boolean",
      description: "Nimmt sichtbare Content-Elemente der Seiten als Navigationspunkte mit auf.",
    },
  },
};

async function render(node: Node, _vars: any = {}): Promise<string> {
  const cms = node.cms;
  const settings = node.settings;

  // Ensure settings exist
  //  await SET.make("filter_visible", "visible");

  // Determine active page
  const activeByRenderPath = await settings["active page by renderpath"];
  //await activeByRenderPath.setType("bool");
  let ActivePage: any;
  if (activeByRenderPath) {
    const firstId = cms.RenderPath.values().next().value;
    const firstPage = firstId ? await cms.node(firstId) : null;
    ActivePage = firstPage ? await firstPage.page() : cms.MainNode;
  } else {
    ActivePage = cms.MainNode;
  }

  // Determine start page
  const startPageSetting = await settings.startPage;
  const startLevelSetting = await settings.startLevel;

  let StartPage: any;
  if (startPageSetting) {
    StartPage = await cms.node(parseInt(String(startPageSetting)));
    if (!(await StartPage.is())) StartPage = await node.page();
  } else {
    StartPage = await node.page();
  }

  if (startLevelSetting) {
    StartPage = await ActivePage.Parent(parseInt(String(startLevelSetting)));
    if (!StartPage || !(await StartPage.is())) {
      StartPage = await node.page();
    }
  }

  // Settings for rendering
  const filterVisible = await settings.filter_visible;
  const levelLimitSetting = await settings.level;
  const pathOnly = await settings.pathOnly;
  const includeContentsSetting = await settings["include contents"];

  let level = 0;

  const getUl = async (CurPage: any): Promise<string | false> => {
    if (!CurPage || !(await CurPage.is())) return "";

    // Collect children
    const readableChildren: any[] = [];
    const allChildren = await CurPage.children("readable");
    for (const C of allChildren.values()) {
      if (filterVisible === "visible" && !C.vs.visible) continue;
      if (filterVisible === "hidden" && C.vs.visible) continue;
      readableChildren.push(C);
    }

    // Optionally include content items (contents of children)
    if (includeContentsSetting) {
      const conts = await CurPage.conts();
      for (const FirstLevelCont of Object.values(conts) as any[]) {
        const bough = await FirstLevelCont.bough(["readable", { type: "c" }]);
        for (const Content of bough.values()) {
          if (Content.vs.visible) readableChildren.push(Content);
        }
      }
    }

    // Filter: skip entries without a title
    const filtered: any[] = [];
    for (const C of readableChildren) {
      const titleObj = await C.title();
      if (titleObj && (await titleObj.string()).trim()) filtered.push(C);
    }

    if (!filtered.length) return false;

    const levelLimit = parseInt(String(levelLimitSetting || 0));
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
