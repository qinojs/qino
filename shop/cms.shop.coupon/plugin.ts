import { Access, getCtx, s, sql, unixTime } from "@qino/qino";
import { toMinor } from "@qino/qino/fin";
import { cart, listen, mainCurrency, shopT } from "@qino/qino/cms.shop";

import type { ApiTree, App, Row } from "@qino/qino";
import type { Extra, Order } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// This module's column on the order row; the accessor comes from the table.
declare module "@qino/qino/cms.shop" {
  interface Order { coupon: string | null }
}

/** Between its days, the last one included. */
const valid = (coupon: Row | undefined, now = unixTime()) =>
  !!coupon && (!Number(coupon.start) || Number(coupon.start) <= now) && (!Number(coupon.end) || Number(coupon.end) + 86400 > now);

const couponOf = (app: App, code: unknown) => code ? app.db.row`SELECT * FROM shop_coupon WHERE code = ${code}` : undefined;

/** Whether this customer has placed an order with it: the user, or the same email. */
async function used(order: Order, code: unknown): Promise<boolean> {
  const who = [
    order.usr_id ? sql`usr_id = ${order.usr_id}` : null,
    order.email ? sql`email = ${order.email}` : null,
  ].filter((w) => w != null);
  if (!who.length) return false;
  return await order.$table.db.one`SELECT 1 FROM shop_order WHERE status NOT IN (${"cart"}, ${"canceled"}) AND coupon = ${code} AND (${sql.join(who, " OR ")}) LIMIT 1` != null;
}

/** What it takes off: a percentage of the regular prices, or an amount, up to what the order costs. */
async function discount(app: App, order: Order, coupon: Row, others: Extra[]): Promise<number> {
  const main = await mainCurrency(app), currency = await order.currencyRow(), node = Number(coupon.node_id);
  let base = 0;
  for (const line of await order.lines()) {
    const product = await line.product();
    if (!product || (node && !await (await product.node()).in(node))) continue;
    const variant = await line.variant(), regular = Number(variant?.price ?? product.price) * Number(currency?.factor ?? 1);
    if (coupon.type === "percent" && Number(line.price) < regular) continue; // reduced already
    base += line.total();
  }
  if (coupon.type === "percent") return base * Number(coupon.value) / 100;
  if (!node) base += others.reduce((sum, x) => sum + x.price, 0);
  const amount = toMinor(Number(coupon.value), main?.$id ?? "");
  return Math.min(base, currency ? currency.change(amount) : amount);
}

/** What an order paid with its coupon of an amount, in units of the main currency; none for another. */
async function spentOn(app: App, order: Order): Promise<{ coupon: Row; spent: number } | undefined> {
  const coupon = await couponOf(app, order.coupon);
  if (coupon?.type !== "money" || Number(coupon.constant)) return;
  const paid = (await order.extras()).find((x) => x.key === "coupon");
  if (!paid) return;
  const currency = await order.currencyRow(), main = await mainCurrency(app);
  return { coupon, spent: -paid.price / (currency ? Number(currency.factor) : 1) / toMinor(1, main?.$id ?? "") };
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  const on = listen(app, signal);

  on("shop:extras", async ({ order, extras }: { order: Order; extras: Extra[] }) => {
    const coupon = await couponOf(app, order.coupon);
    if (!valid(coupon) || (Number(coupon!.once) && await used(order, order.coupon))) return;
    const off = await discount(app, order, coupon!, extras);
    if (!off) return;
    const price = (await order.currencyRow())?.round(off) ?? off;
    extras.push({ key: "coupon", name: `${await t`Coupon`} "${coupon!.title}"`, price: -price, taxRate: await order.taxRate(), sort: 5 });
  });

  // an amount is used up by what it paid, unless it stays as it is
  on("shop:ordered", async ({ order }: { order: Order }) => {
    const use = await spentOn(app, order);
    if (use) await app.db.table("shop_coupon").update(String(use.coupon.code), { value: Math.max(0, Number(use.coupon.value) - use.spent) });
  });

  // a canceled order gives it back
  on("shop:status", async ({ order }: { order: Order }) => {
    const use = order.status === "canceled" ? await spentOn(app, order) : undefined;
    if (use) await app.db.table("shop_coupon").update(String(use.coupon.code), { value: Number(use.coupon.value) + use.spent });
  });
}

export const api: ApiTree = {
  redeem: {
    put: {
      description: "Put a coupon on the visitor's cart; an empty code takes it off",
      access: Access.PUBLIC,
      input: s.object({ code: s.string() }),
      execute: async ({ code }: { code: string }) => {
        const ctx = getCtx(), order = await cart(ctx);
        if (order?.status !== "cart") return { ok: false };
        const value = code.trim();
        if (value && !valid(await couponOf(ctx.app, value))) {
          // codes are guessed one by one: security adds up the misses per address
          ctx.app.fire("suspicious", { ctx, reason: "cms.shop.coupon: unknown code" }).catch(() => {});
          return { ok: false };
        }
        order.coupon = value || null;
        order.forget();
        return { ok: true };
      },
    },
  },
};
