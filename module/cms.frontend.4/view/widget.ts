import { getCtx, hee } from "@qino/qino";

export function widgetUrl(widget: string): string {
  return new URL("./widgets/" + widget + ".ts", import.meta.url).href;
}

/** A sidebar item: the frame and its label. The widget module fills the container on mount. */
export async function sidebar(name: string, title: string, tooltip = ""): Promise<string> {
  const open = await getCtx().settings["cms.frontend.4"].ui.sidebar === name;
  return `<div class="-item ${open ? "-open" : ""}" itemid="${name}">
  <div class=-content widget=${name}></div>
  <div class=-title>
    <div class=-text title="${hee(tooltip)}">${title}</div>
  </div>
</div>`;
}
