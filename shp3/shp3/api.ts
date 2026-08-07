// The shop's frontend API. Page-independent on purpose: a [shp3-add] form may sit on a category
// page, in a teaser or in a sidebar, and the cart is always the visitor's own.
import { Access, getCtx, s, type ApiTree } from "../../module/core/mod.ts";
import { cart } from "./lib/cart.ts";
import { shp3, type Product } from "./mod.ts";

const item = s.object({
  product: s.string(),
  quantity: s.optional(s.number()),
  config: s.optional(s.any()),
});

/** A product the visitor is allowed to buy. The row has to exist already — a page becomes a
 *  product by being rendered as one, never by being named in a request. */
async function sellable(id: string) {
  const product = await getCtx().app.db.table("shp3_product").get<Product>(id);
  if (!product || Object.keys(await product.errors()).length) return;
  return product;
}

async function summary() {
  const order = await cart(getCtx(), false);
  if (!order) return { items: 0, quantity: 0, net: 0, gross: 0, currency: "", grossText: "" };
  const items = await order.items();
  const costs = await order.costs();
  const currency = await order.currencyRow();
  return {
    items: items.length,
    quantity: items.reduce((sum, i) => sum + i.quantity, 0),
    net: costs.net,
    gross: costs.gross,
    currency: currency?.id ?? "",
    // Formatted here: how many decimals a currency shows is the currency's business.
    grossText: currency ? currency.format(costs.gross) : String(costs.gross),
  };
}

export const api: ApiTree = {

  cart: {
    get: {
      description: "The visitor's cart in numbers — for a badge or a mini cart",
      access: Access.PUBLIC,
      execute: summary,
    },
    items: {
      post: {
        description: "Put a product into the cart",
        access: Access.PUBLIC,
        input: item,
        execute: async ({ product, quantity = 1, config = null }: { product: string; quantity?: number; config?: unknown }) => {
          const sold = await sellable(product);
          if (!sold) return { error: "not available" };
          const order = await cart(getCtx());
          const line = await order!.itemAdd(sold, Math.max(1, Math.trunc(quantity)), config);
          await getCtx().app.db.flush();
          return { item: line.$id, quantity: line.quantity, cart: await summary() };
        },
      },
      ":id": {
        put: {
          description: "Change the amount of a line; zero removes it",
          access: Access.PUBLIC,
          input: s.object({ quantity: s.number() }),
          execute: async ({ id, quantity }: { id: string; quantity: number }) => {
            const [order, line] = await line_(id);
            if (!line) return { error: "not in your cart" };
            const amount = Math.max(0, Math.trunc(quantity));
            amount ? await line.setQuantity(amount) : await order!.itemRemove(line);
            await getCtx().app.db.flush();
            return { quantity: amount, cart: await summary() };
          },
        },
        delete: {
          description: "Take a line out of the cart",
          access: Access.PUBLIC,
          execute: async ({ id }: { id: string }) => {
            const [order, line] = await line_(id);
            if (!line) return { error: "not in your cart" };
            await order!.itemRemove(line);
            return { cart: await summary() };
          },
        },
        solve: {
          post: {
            description: "Apply what changed under the customer's feet, or drop the line",
            access: Access.PUBLIC,
            execute: async ({ id }: { id: string }) => {
              const [order, line] = await line_(id);
              if (!line) return { error: "not in your cart" };
              const kept = await order!.resolveItem(line);
              await getCtx().app.db.flush();
              return { kept: !!kept, cart: await summary() };
            },
          },
        },
      },
    },
    currency: {
      put: {
        description: "Switch the currency of the cart",
        access: Access.PUBLIC,
        input: s.object({ value: s.string() }),
        execute: async ({ value }: { value: string }) => {
          const order = await cart(getCtx());
          if (!order) return { error: "no cart" };
          const switched = await order.setCurrency(value).catch(() => undefined);
          if (!switched) return { error: "not available" };
          await getCtx().app.db.flush();
          return { cart: await summary() };
        },
      },
    },
    shipping: {
      put: {
        description: "Choose the delivery method",
        access: Access.PUBLIC,
        input: s.object({ value: s.string() }),
        execute: ({ value }: { value: string }) => choose("shipping", value),
      },
    },
    payment: {
      put: {
        description: "Choose the payment method",
        access: Access.PUBLIC,
        input: s.object({ value: s.string() }),
        execute: ({ value }: { value: string }) => choose("payment", value),
      },
    },
    address: {
      put: {
        description: "Store the billing and delivery address",
        access: Access.PUBLIC,
        input: s.object({ values: s.record() }),
        execute: async ({ values }: { values: Record<string, unknown> }) => {
          const order = await cart(getCtx());
          if (!order) return { error: "no cart" };
          // Only the address columns, and only the ones this shop actually has.
          for (const [name, value] of Object.entries(values)) {
            if (!/^(bill|ship)_/.test(name) || !order.$table.field(name)) continue;
            let v = typeof value === "string" ? value.trim() : value;
            if (name.endsWith("_email") && typeof v === "string") v = v.toLowerCase();
            // A country the shop does not deliver to is no address — it would carry a VAT rate.
            if (name.endsWith("_country") && typeof v === "string") v = await shp3(getCtx().app).sellsTo(v.toUpperCase()) ? v.toUpperCase() : "";
            order.$set(name, v);
          }
          await order.$save();
          return { cart: await summary() };
        },
      },
    },
    order: {
      post: {
        description: "Place the order, unless something still blocks it",
        access: Access.PUBLIC,
        input: s.object({ config: s.optional(s.any()) }),
        execute: async ({ config = null }: { config?: unknown }) => {
          const order = await cart(getCtx(), false);
          if (!order) return { success: false, errors: {}, redirect: "" };
          const result = await order.tryPlace(config);
          return { ...result, order: order.$id };
        },
      },
    },
  },

  price: {
    post: {
      description: "What a product costs right now, for the given amount and configuration",
      access: Access.PUBLIC,
      input: item,
      execute: async ({ product, quantity = 1, config = null }: { product: string; quantity?: number; config?: unknown }) => {
        const sold = await sellable(product);
        if (!sold) return { error: "not available" };
        const order = await cart(getCtx(), false);
        // A price is shown long before anything is in the cart — without a fallback it would
        // skip the conversion and arrive unlabelled.
        const currency = await order?.currencyRow() ?? await shp3(getCtx().app).mainCurrency();
        const country = order?.shipCountry() ?? "";
        const prices = await sold.pricesFor({ currency, quantity, config, country, grps: await order?.grps() });
        return {
          ...prices,
          vat_rate: await sold.vatRateFor(country),
          currency: currency?.id ?? "",
          netText: currency ? currency.format(prices.net) : String(prices.net),
          grossText: currency ? currency.format(prices.gross) : String(prices.gross),
        };
      },
    },
  },
};

/** A line of the visitor's own cart — an id from the request never reaches another order. */
async function line_(id: string) {
  const order = await cart(getCtx(), false);
  if (!order || order.time_ordered) return [undefined, undefined] as const;
  return [order, await order.item(id)] as const;
}

async function choose(what: "shipping" | "payment", value: string) {
  const order = await cart(getCtx());
  if (!order) return { error: "no cart" };
  const allowed = what === "shipping" ? await order.allowedShippings() : await order.allowedPayments();
  if (value && !(value in allowed)) return { error: "not available" };
  order.$set(what, value);
  await order.$save();
  return { cart: await summary() };
}
