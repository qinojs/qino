import { html, type HtmlString } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";

// Renders the backendDashboardWidget of every visible child page as a card.
// Shared by the backend dashboard and the grouping pages (e.g. superuser).
export async function renderDashboard(node: Node): Promise<HtmlString> {
  const page = await node.page();
  const children = [...(await page.children()).values()];
  const widgets: HtmlString[] = [];

  for (const child of children) {
    if (!child.vs.visible || !(await child.access())) continue; // only visible pages the user may see
    const cont = (await child.conts())[0];
    const widget = cont?.module?.plugin.backendDashboardWidget;
    if (typeof widget !== "function") continue;
    try {
      const body = await widget(node.app, child); // child = the widget's own backend page, for deep links
      if (!body) continue;
      const url = await child.url();
      const title = await (await child.title()).string();
      // widget bodies are trusted markup from the module itself
      widgets.push(html`<div class=u2-card><a class=-head href="${url}">${title}</a>${html.raw(body)}</div>`);
    } catch (e) { console.error(e); }
  }

  const widgetsHtml = widgets.length
    ? html.join(widgets, "\n")
    : html`<div class=u2-card><div class=-body style="color:#999">No widgets available.</div></div>`;

  return html`<div class=u2-flex>${widgetsHtml}</div>`;
}
