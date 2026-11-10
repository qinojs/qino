// The shop's frontend API, independent of pages: an add-to-cart form may sit anywhere, and the
// cart is always the visitor's own.
import { Access, getCtx, s } from "@qino/qino";

import { cart } from "./lib/cart.ts";
import { mainCurrency, sellsTo } from "./lib/shop.ts";

import type { ApiTree } from "@qino/qino";
import type { Order, Party, Product } from "./lib/rows.ts";

const line = s.object({
  product: s.string(),
  variant: s.optional(s.string()),
  quantity: s.optional(s.number()),
  data: s.optional(s.any()),
});
const party = s.object({
  name: s.optional(s.string()),
  honorificPrefix: s.optional(s.string()),
  givenName: s.optional(s.string()),
  familyName: s.optional(s.string()),
  organization: s.optional(s.string()),
  email: s.optional(s.string()),
  telephone: s.optional(s.string()),
  address: s.optional(s.record<string>()),
});

/** A product the visitor may buy (the row exists once its page renders as a product). */
async function sellable(id: string, variantId?: string) {
  const product = await getCtx().app.db.table("shop_product").get<Product>(id);
  if (!product) return;
  const variant = variantId ? await product.variant(variantId) : undefined;
  if (variantId && !variant) return;
  if (Object.keys(await product.errors(variant)).length) return;
  return { product, variant };
}

/** The cart in numbers — for a badge or a mini cart. */
async function summary(order?: Order) {
  order ??= await cart(getCtx(), false);
  if (!order) return { lines: 0, quantity: 0, total: 0, currency: "", totalText: "" };
  const [lines, { total }, row] = await Promise.all([order.lines(), order.totals(), order.currencyRow()]);
  return {
    lines: lines.length,
    quantity: lines.reduce((sum, l) => sum + Number(l.quantity), 0),
    total,
    currency: row?.$id ?? "",
    totalText: row ? row.format(total) : String(total),
  };
}

/** The visitor's open cart, created on demand. */
async function open() {
  const order = await cart(getCtx());
  if (order?.status !== "cart") throw new Error("cms.shop: no open cart");
  return order;
}

/** A line of the visitor's own cart — an id from a request never reaches another order. */
async function own(id: string) {
  const order = await cart(getCtx(), false);
  return order?.status === "cart" ? [order, await order.line(id)] as const : [undefined, undefined] as const;
}

/** Start the payment. The order stands either way: if the provider fails, the customer is told and
 *  can try again — an error here must not look as if nothing had been ordered. */
async function startPayment(order: Order, back: string): Promise<{ redirect: string; paymentFailed?: boolean }> {
  // the payer comes back to this site only: the link would otherwise lead anywhere
  const { url, appUrl } = getCtx().req, to = URL.parse(back, url.href);
  try {
    return await order.pay({ return: to?.origin === url.origin ? to.href : url.origin + appUrl });
  } catch (e) {
    console.error(`cms.shop: payment of order ${order.$id} did not start`, e);
    return { redirect: "", paymentFailed: true };
  }
}

/** An order waiting for payment that belongs to this visitor: their user's, or placed in this session. */
async function placedOrder(id: string): Promise<Order | undefined> {
  const ctx = getCtx(), order = await ctx.app.db.table("shop_order").get<Order>(id);
  if (order?.status !== "ordered") return;
  const mine = ctx.userId && String(order.usr_id) === String(ctx.userId);
  return mine || String(ctx.sess.data["cms.shop"].placed() ?? "") === order.$id ? order : undefined;
}

async function choose(what: "shipping" | "payment", value: string) {
  const order = await open();
  const methods = what === "shipping" ? await order.shippings() : await order.payments();
  if (value && !methods.some((m) => m.name === value)) return { error: "not available" };
  order[what] = value;
  order.forget(); // a method may cost something
  return { cart: await summary(order) };
}

/** Trimmed strings, the email lower case; a country the shop does not deliver to is no address. */
async function clean(input: Party): Promise<Party | undefined> {
  const out: Party = {};
  for (const [k, v] of Object.entries(input)) if (typeof v === "string" && v.trim()) (out as Record<string, string>)[k] = v.trim();
  if (out.email) out.email = out.email.toLowerCase();
  if (input.address) {
    const address = out.address = Object.fromEntries(Object.entries(input.address).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v));
    const country = address.addressCountry = address.addressCountry?.toUpperCase() ?? "";
    if (country && !await sellsTo(getCtx().app, country)) return;
  }
  out.name ??= out.organization || [out.givenName, out.familyName].filter(Boolean).join(" ") || undefined;
  return out;
}

export const api: ApiTree = {
  cart: {
    get: { description: "The visitor's cart in numbers", access: Access.PUBLIC, execute: () => summary() },
    lines: {
      post: {
        description: "Put a product into the cart",
        access: Access.PUBLIC,
        input: line,
        execute: async ({ product, variant, quantity = 1, data = null }: { product: string; variant?: string; quantity?: number; data?: unknown }) => {
          const sold = await sellable(product, variant);
          if (!sold) return { error: "not available" };
          const order = await open();
          const added = await order.add(sold.product, { variant: sold.variant, quantity: Math.max(1, Math.trunc(quantity)), data });
          return { line: added.$id, quantity: added.quantity, cart: await summary(order) };
        },
      },
      ":id": {
        put: {
          description: "Change the amount of a line; zero removes it",
          access: Access.PUBLIC,
          input: s.object({ quantity: s.number() }),
          execute: async ({ id, quantity }: { id: string; quantity: number }) => {
            const [order, found] = await own(id);
            if (!found) return { error: "not in your cart" };
            quantity > 0 ? await found.setQuantity(quantity) : await order!.remove(found);
            return { quantity: quantity > 0 ? found.quantity : 0, cart: await summary(order) };
          },
        },
        delete: {
          description: "Take a line out of the cart",
          access: Access.PUBLIC,
          execute: async ({ id }: { id: string }) => {
            const [order, found] = await own(id);
            if (!found) return { error: "not in your cart" };
            await order!.remove(found);
            return { cart: await summary(order) };
          },
        },
        solve: {
          post: {
            description: "Take a way out of an error of a line, as offered by its check",
            access: Access.PUBLIC,
            input: s.object({ solution: s.string() }),
            execute: async ({ id, solution }: { id: string; solution: string }) => {
              const [order, found] = await own(id);
              if (!found) return { error: "not in your cart" };
              if (!await found.solve(solution)) return { error: "not available" };
              return { cart: await summary(order) };
            },
          },
        },
      },
    },
    country: {
      put: {
        description: "Where the order goes — tax, currency and what may be sold follow from it",
        access: Access.PUBLIC,
        input: s.object({ value: s.string() }),
        execute: async ({ value }: { value: string }) => {
          const country = value.toUpperCase();
          if (!await sellsTo(getCtx().app, country)) return { error: "not available" };
          const order = await open();
          await order.setCountry(country);
          return { cart: await summary(order) };
        },
      },
    },
    currency: {
      put: {
        description: "Switch the currency of the cart",
        access: Access.PUBLIC,
        input: s.object({ value: s.string() }),
        execute: async ({ value }: { value: string }) => {
          const order = await open();
          if (!await order.setCurrency(value).catch(() => undefined)) return { error: "not available" };
          return { cart: await summary(order) };
        },
      },
    },
    shipping: {
      put: { description: "Choose the delivery method", access: Access.PUBLIC, input: s.object({ value: s.string() }), execute: ({ value }: { value: string }) => choose("shipping", value) },
    },
    payment: {
      put: { description: "Choose the payment method", access: Access.PUBLIC, input: s.object({ value: s.string() }), execute: ({ value }: { value: string }) => choose("payment", value) },
    },
    party: {
      put: {
        description: "Store the billing or the delivery party; none for delivery: same as billing",
        access: Access.PUBLIC,
        input: s.object({ kind: s.enum(["bill", "ship"]), party: s.optional(party) }),
        execute: async ({ kind, party }: { kind: "bill" | "ship"; party?: Party }) => {
          const order = await open();
          const cleaned = party ? await clean(party) : null;
          if (cleaned === undefined) return { error: "country not available" };
          await order.setParty(kind, cleaned);
          return { cart: await summary(order) };
        },
      },
    },
    data: {
      put: {
        description: "Store what a checkout step asks for (a comment, terms accepted)",
        access: Access.PUBLIC,
        input: s.object({ values: s.record() }),
        execute: async ({ values }: { values: Record<string, unknown> }) => {
          const order = await open();
          order.data = JSON.stringify({ ...order.dataOf(), ...values });
          order.forget();
          return { cart: await summary(order) };
        },
      },
    },
    order: {
      post: {
        description: "Place the order unless something blocks it, then start the payment",
        access: Access.PUBLIC,
        input: s.object({ return: s.string() }),
        execute: async ({ return: back }: { return: string }) => {
          const order = await cart(getCtx(), false);
          if (order?.status !== "cart") return { ok: false, errors: { "has lines": "" }, redirect: "" };
          const placed = await order.place();
          if (!placed.ok) return { ...placed, order: order.$id };
          getCtx().sess.data["cms.shop"].placed(order.$id); // a guest may still pay for it, see order/:id/pay
          if (placed.redirect || !order.total || !order.payment) return { ...placed, order: order.$id };
          return { ...placed, ...await startPayment(order, back), order: order.$id };
        },
      },
    },
  },

  order: {
    ":id": {
      pay: {
        post: {
          description: "Start the payment of a placed order again; only one's own",
          access: Access.PUBLIC,
          input: s.object({ return: s.string() }),
          execute: async ({ id, return: back }: { id: string; return: string }) => {
            const order = await placedOrder(id);
            if (!order) return { error: "not your order" };
            return startPayment(order, back);
          },
        },
      },
    },
  },

  price: {
    post: {
      description: "What a product costs right now, for the amount, the variant and the data given",
      access: Access.PUBLIC,
      input: line,
      execute: async ({ product, variant, quantity = 1, data = null }: { product: string; variant?: string; quantity?: number; data?: unknown }) => {
        const sold = await sellable(product, variant);
        if (!sold) return { error: "not available" };
        const app = getCtx().app, order = await cart(getCtx(), false);
        const row = await order?.currencyRow() ?? await mainCurrency(app);
        const prices = await sold.product.prices({ variant: sold.variant, quantity, order, currency: row, data });
        return { ...prices, currency: row?.$id ?? "", grossText: row?.format(prices.gross) ?? "", netText: row?.format(prices.net) ?? "" };
      },
    },
  },
};
