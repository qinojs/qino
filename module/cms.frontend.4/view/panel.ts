import { getCtx, html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";

/** A sidebar item: the frame and its label. The widget module fills the container on mount. */
function sidebar(name: string, title: unknown, tooltip: unknown, open: boolean): Promise<HtmlString> {
  return html.async`<div class="-item ${open ? "-open" : ""}" itemid="${name}">
  <div class=-content widget=${name}></div>
  <div class=-title>
    <div class=-text title="${tooltip}">${title}</div>
  </div>
</div>`;
}

export default function (): Promise<HtmlString> {
  const ctx = getCtx();
  const t = ctx.app.t;
  const open = Promise.resolve(ctx.settings["cms.frontend.4"].ui.sidebar); // read once, awaited four times
  const item = async (name: string, title: unknown, tooltip: unknown) =>
    sidebar(name, title, tooltip, await open === name);

  return html.async`<qino-cms hidden>
<div id=panel popover=manual class="qgCMS -open -sidebar-open">
  <div class=-sidebar>
    <a class="-item qgCMS_editmode_switch -active" href="" title="Edit (E)">
      <div><i></i></div>
    </a>
    ${item("tree", t`Structure`, t`Overview. Create, move, delete pages...`)}
    ${item("settings", t`Settings`, t`Settings, files, permissions of the current page`)}
    ${item("add", t`Modules`, t`Add content, e.g. a text field or a table`)}
    ${item("more", t`More`, t`CMS feedback, change password...`)}
    <div class=-sensor></div>
  </div>
</div>
</qino-cms>`;
}
