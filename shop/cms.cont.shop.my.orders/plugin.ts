import { html } from "@qino/qino";
import { orderTable, shopT } from "@qino/qino/cms.shop";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Order } from "@qino/qino/cms.shop";

const date = (time: unknown, lang: string) => new Date(Number(time) * 1000).toLocaleDateString(lang);

/** One's own only: an order number from the address never reaches someone else's. */
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = shopT(node.app);
  if (!ctx.userId) return html`<div hidden></div>`;
  const url = ctx.req.url.toURL(), id = url.searchParams.get("shop_order");
  const order = id ? await node.app.db.table("shop_order").get<Order>(id) : undefined;
  if (order && order.status !== "cart" && String(order.usr_id) === String(ctx.userId)) return detail(node, ctx, order, url);
  const orders = await node.app.db.table("shop_order").all<Order>`WHERE usr_id = ${ctx.userId} AND status <> ${"cart"} ORDER BY ordered DESC`;
  if (!orders.length) return html.async`<div>${t`You have not ordered anything yet`}</div>`;
  return html.async`<div>
  <table class=u2-table>
    <thead><tr>
      <th>${t`No.`}
      <th>${t`Ordered`}
      <th>${t`Delivery`}
      <th>${t`Payment`}
      <th>${t`Total`}
    <tbody>${orders.map(async (o) => html.async`<tr>
      <td><a href="${`${url.pathname}?shop_order=${o.$id}`}">${o.$id}</a>
      <td>${date(o.ordered, ctx.lang)}
      <td>${o.label(o.shipping)}
      <td>${o.label(o.payment)}
      <td>${(await o.currencyRow())?.show(Number(o.total)) ?? o.total}`)}
  </table>
</div>`;
}

async function detail(node: Node, ctx: Ctx, order: Order, url: URL): Promise<HtmlString> {
  const t = shopT(node.app);
  return html.async`<div>
  <a class=-back href="${url.pathname}">${t`Back`}</a>
  <h2>${t`Order`} ${order.$id}</h2>
  ${orderTable(order)}
  <p>${t`Delivery`}: ${order.label(order.shipping)}<br>${t`Payment`}: ${order.label(order.payment)}</p>
  ${order.status === "ordered" && order.payment && Number(order.total) ? html.async`<button class=-pay data-order="${order.$id}">${t`Pay now`}</button>` : ""}
</div>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js", "pub/main.js"] } };
