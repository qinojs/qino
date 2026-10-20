import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// Renders the backendDashboardWidget of every visible child page as a card.
// Shared by the backend dashboard and the grouping pages (e.g. superuser).
export async function renderDashboard(node: Node): Promise<HtmlString> {
  const page = await node.page();
  const children = [...(await page.children()).values()];
  const widgets = [];

  for (const child of children) {
    if (!child.vs.visible || !(await child.access())) continue; // only visible pages the user may see
    const cont = (await child.conts())[0];
    const widget = cont?.module?.plugin.backendDashboardWidget;
    if (typeof widget !== "function") continue;
    try {
      const body = await widget(node.app, child); // child = the widget's own backend page, for deep links
      if (body) widgets.push(await card(child, body));
    } catch (e) { console.error(e); }
  }

  const widgetsHtml = widgets.length
    ? html.join(widgets, "\n")
    : html`<div class=u2-card><div class=-body style="color:#999">No widgets available.</div></div>`;

  return html`<div class=u2-flex>${widgetsHtml}</div>`;
}

/** A widget as card, headed by a link to the module's backend page. Widget bodies are trusted markup
 *  from the module itself. */
async function card(page: Node, body: unknown): Promise<HtmlString> {
  const [url, title] = await Promise.all([page.url(), page.title()]);
  return html`<div class=u2-card><a class=-head href="${url}">${await title.string()}</a>${html.raw(String(body))}</div>`;
}

/**
 * Cards for one row of `table` (a user, a group, a product …) from every module whose plugin exports
 * `backendRowWidget[table](app, id, page)`. A module adds its card only where the viewer may see its
 * backend page: what the card shows, that page shows anyway. An empty result adds no card.
 */
export async function renderRowWidgets(node: Node, table: string, id: unknown): Promise<HtmlString> {
  const cards = [];
  for (const mod of node.app.modules.linked()) {
    const widget = mod.plugin.backendRowWidget?.[table];
    if (typeof widget !== "function") continue;
    const page = await (await node.cms.nodeByModule(mod.name))?.page();
    if (!page || !(await page.access())) continue;
    try {
      const body = await widget(node.app, id, page);
      if (body) cards.push(await card(page, body));
    } catch (e) { console.error(e); }
  }
  return html.join(cards, "\n");
}
