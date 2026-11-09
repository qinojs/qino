import { html, unixTime } from "@qino/qino";
import { cart, ensureProduct, mainCurrency, shopT } from "@qino/qino/cms.shop";
import { busy, factorAt, rentals, rules, step } from "@qino/qino/cms.shop.rent";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Range } from "@qino/qino/cms.shop.rent";

const DAY = 86400;

/** Midnight of the days of a week, `week` weeks from this one, local time. */
function weekOf(week: number): Date[] {
  const now = new Date(), monday = now.getDate() - (now.getDay() + 6) % 7 + 7 * week;
  return [...Array(8)].map((_, i) => new Date(now.getFullYear(), now.getMonth(), monday + i));
}

/** Like a product, but its page books times: the product is the page, its interval the step. */
async function render(node: Node, { ctx, vars }: { ctx: Ctx; vars?: { week?: unknown } }) {
  const app = node.app, t = shopT(app), product = await ensureProduct(node);
  const week = Math.max(0, Math.trunc(Number(vars?.week) || 0));
  const seconds = Math.min(step(product), DAY), capacity = Number(product.rent_capacity) || 1;
  const days = weekOf(week), from = days[0].getTime() / 1000, to = days[7].getTime() / 1000;
  const [all, booked, order] = await Promise.all([rules(app, product.$id), rentals(app, product.$id, { begin: from, end: to }), cart(ctx, false)]);
  const currency = await order?.currencyRow() ?? await mainCurrency(app);

  // the visitor's own times, to take back
  const mine = new Map<number, string>();
  for (const line of order ? await order.lines() : []) {
    if (String(line.product_id) !== product.$id) continue;
    for (const r of (line.dataOf() as { rent?: Range[] } | null)?.rent ?? []) mine.set(Number(r.begin), line.$id);
  }
  // one price per factor: the rules make a few of them, the cart computes the same
  const prices = new Map<number, Promise<string>>();
  const priceOf = (factor: number, range: Range) => prices.get(factor) ?? prices.set(factor,
    product.prices({ order, currency, data: { rent: [range] } }).then(({ gross }) => String(currency?.show(gross) ?? gross))).get(factor)!;

  const now = unixTime(), lang = ctx.lang;
  const slots = [...Array(Math.ceil(DAY / seconds))].map((_, i) => days.slice(0, 7).map((day) => {
    const begin = day.getTime() / 1000 + i * seconds, range = { begin, end: begin + seconds };
    return { range, factor: factorAt(all, new Date(begin * 1000)), left: capacity - busy(booked, range) };
  })).filter((row) => row.some((s) => s.factor != null)); // a time closed all week is no row

  const cell = ({ range, factor, left }: (typeof slots)[0][0]) => {
    const line = mine.get(range.begin);
    if (line) return html.async`<button type=button class=-mine data-line="${line}">✓ ${priceOf(factor ?? 1, range)}</button>`;
    if (factor == null || range.begin < now) return html``;
    if (left <= 0) return html.async`<button type=button disabled>${t`Booked`}</button>`;
    return html.async`<button type=button data-begin=${range.begin} data-end=${range.end}>${priceOf(factor, range)}${
      capacity > 1 ? html.async`<small>${left} ${t`free`}</small>` : ""}</button>`;
  };
  const day = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "numeric" });
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });

  return html.async`<div data-product="${product.$id}" data-week=${week}>
  ${node.cms.text(node, "title", { tag: "h2", class: "-title" })}
  ${node.cms.text(node, "main", { class: "-text", if: true })}
  <div class=-nav>
    <button type=button data-to=${week - 1} ${week ? "" : html`disabled`}>${t`Earlier`}</button>
    <button type=button data-to=${week + 1}>${t`Later`}</button>
  </div>
  <div class=-slots><table class=u2-table>
    <thead><tr>${seconds < DAY ? html`<th>` : ""}${days.slice(0, 7).map((d) => html`<th>${day.format(d)}`)}
    <tbody>${slots.map((row) => html.async`<tr>${seconds < DAY ? html`<th>${time.format(new Date(row[0].range.begin * 1000))}` : ""}${
      row.map((s) => html.async`<td>${cell(s)}`)}`)}
  </table></div>
</div>`;
}

export const cms = { node: { render, css: ["pub/main.css"], js: ["../cms.shop/pub/shop.js", "pub/main.js"] } };
