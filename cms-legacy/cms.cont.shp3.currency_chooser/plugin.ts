import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cart, shp3, type Currency } from "../../shp3/shp3/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

const settingsSchema = {
  properties: {
    type: { type: "string", enum: ["select", "links"], default: "select" },
    hide_active: { type: "boolean", description: "Hides the active currency in link mode." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.html.styles.add(node.module!.dataUrl + "pub/main.css");
  const order = await cart(ctx, false);
  const active = await order?.currencyRow() ?? await shp3(node.app).mainCurrency();
  const currencies = await node.app.db.table("shp3_currency").all<Currency>`WHERE active = ${true} ORDER BY main DESC, id`;
  const hide = !!await node.settings.hide_active();
  const label = await node.app.t`Currency`;

  if (await node.settings.type() !== "links") {
    return html`<label><span class=-label>${label}:</span>
      <select name=shp3_currency>${html.join(currencies.map((c) =>
        html`<option value=${c.id} ${c.id === active?.id ? html.raw("selected") : ""}>${c.id}</option>`
      ))}</select>
    </label>`;
  }

  return html`<label><span class=-label>${label}:</span>${html.join(currencies
    .filter((c) => !hide || c.id !== active?.id)
    .map((c) => html`<button type=button data-currency=${c.id} class="${c.id === active?.id ? "-active" : ""}">${c.id}</button>`))}</label>`;
}

export const cms = { node: { render, js: ["pub/main.js"], settingsSchema } };
