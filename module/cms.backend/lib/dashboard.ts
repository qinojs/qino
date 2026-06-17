import { hee } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";

// Renders the backendDashboardWidget of every visible child page as a card.
// Shared by the backend dashboard and the grouping pages (e.g. superuser).
export async function renderDashboard(node: Node): Promise<string> {
  const page = await node.page();
  const children = [...(await page.children()).values()];
  const widgets: string[] = [];

  for (const child of children) {
    if (!child.vs.visible) continue;
    const cont = (await child.conts())[0];
    const widget = cont?.module?.plugin.backendDashboardWidget;
    if (typeof widget !== "function") continue;
    try {
      const body = await widget(node.app);
      if (!body) continue;
      const url = hee(await child.url());
      const title = hee(await (await child.title()).string());
      widgets.push(`<div class=u2-card><a class="-head" href="${url}">${title}</a>${body}</div>`);
    } catch (e) { console.error(e); }
  }

  const widgetsHtml = widgets.length
    ? widgets.join("\n")
    : `<div class="u2-card"><div class="-body" style="color:#999">No widgets available.</div></div>`;

  return `<div class="u2-flex">${widgetsHtml}</div>`;
}
