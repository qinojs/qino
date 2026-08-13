import { html, type HtmlString, type Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { cart } from "@qino/qino/shp3";

const settingsSchema = {
  properties: {
    success_page: { type: "integer", minimum: 1, description: "Page the customer lands on after ordering. Default: the first child of this page." },
    back_page: { type: "integer", minimum: 1, description: "Page the back link points to. Default: the previous page." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const order = await cart(ctx, false);
  if (!order) return html.async`<div></div>`;

  // Shown, not hidden: the customer has to know what is missing before pressing anything.
  const errors = Object.values(await order.errors());
  const page = await node.page();
  // Where the customer lands afterwards, and where the way back leads — both default to the tree.
  const successId = Number(await node.settings.success_page());
  const success = successId ? await node.cms.node(successId) : [...(await page.children()).values()][0];
  const backId = Number(await node.settings.back_page());
  const back = backId ? await node.cms.node(backId) : await page.parent();

  return html.async`<div>
  ${errors.length ? html`<ul class=-errors>${html.join(errors.map((e) => html`<li>${e}</li>`))}</ul>` : ""}
  ${back?.exists() ? html`<a class=-back href="${await back.url()}">${await t`Back`}</a>` : ""}
  <form class=-buy data-success=${success ? await success.url() : ""}>
    <button ${errors.length ? html.raw("disabled") : html.raw("")}>${t`Buy`}</button>
  </form>
</div>`;
}

export const cms = { node: { render, js: ["../shp3/pub/shp3.js", "pub/main.js"], settingsSchema } };
