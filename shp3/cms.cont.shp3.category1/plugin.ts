import { html, type HtmlString, type Ctx } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { ensureProduct, shp3, type Product } from "../shp3/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

const settingsSchema = {
  properties: {
    quantity: { type: "boolean", default: true, description: "Whether the customer can pick an amount right here." },
    width: { type: "integer", default: 300, description: "Width of the product image in pixels." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const { app } = node;
  const t = app.t;
  const module = String(await app.settings.shp3.default_product_module ?? "");
  // A product is whatever carries the product module — page or container, the old shop nests
  // them as containers below the category.
  const products = await node.children({ type: "*", module, access: 1 });
  if (!products.size) return html.async`<div></div>`;

  const currency = await shp3(app).mainCurrency();
  const withQuantity = await node.settings.quantity() !== false;
  const width = Number(await node.settings.width()) || 300;

  const items: HtmlString[] = [];
  for (const child of products.values()) {
    const product = await ensureProduct(child) as Product | undefined;
    if (!product) continue;
    const prices = await product.pricesFor({ currency, quantity: 1 });
    // The regular price is the one before any time-limited offer — same amount, no moment.
    const regular = await product.pricesFor({ currency, quantity: 1, time: 0 });
    const cheaper = prices.gross < regular.gross;

    items.push(html`<div class=-item itemid=${child.id}>
      <a href="${await child.url()}" class=-info>
        ${await image(child, width)}
        <h2 class=-title>${await child.title(ctx.lang)}</h2>
        <div class=-price>
          <span class=${cheaper ? "-offer" : "-normal"}>${currency ? currency.show(prices.gross) : prices.gross}</span>
          ${cheaper ? html`<s class=-regular>${currency ? currency.show(regular.gross) : regular.gross}</s>` : ""}
        </div>
      </a>
      <form shp3-add class=-buy>
        <input type=hidden name=product_id value=${child.id}>
        ${withQuantity ? html`<input type=number name=quantity min=1 step=1 value=1>` : ""}
        <button>${await t`Add to cart`}</button>
      </form>
    </div>`);
  }

  return html.async`<div class=-items>${html.join(items)}</div>`;
}

/** The page's first image, if it has one. */
async function image(node: Node, width: number) {
  for (const file of Object.values(await node.files())) {
    if (!file.mime.startsWith("image/")) continue;
    return html`<img class=-img src="${await file.url({ w: width, max: true })}" alt="" loading=lazy>`;
  }
  return "";
}

export const cms = { node: { render, js: ["../shp3/pub/shp3.js"], settingsSchema } };
