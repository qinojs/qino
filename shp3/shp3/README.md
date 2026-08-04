# shp3

Shop core: products, cart, orders. Ported from `php-legacy/m/shp3`, built on `DbRow`.

## Rows

One class per table, data and behaviour in the same object ([lib/rows.ts](lib/rows.ts)):

```ts
const order = await db.table("shp3_order").get<Order>(33);
order.time_ordered            // column, synchronous
await order.itemAdd(product, 2);
await order.place();
```

Naming rule of the row layer: **columns are data, methods are verbs.** `price` is a column, so the
calculation beside it is `priceFor()`; `vat_rate` is a column, so the live rate is `calcVatRate()`.
A method that collides with a column name throws at boot.

## Extension points

Everything variable is an app event, not a subclass:

| event | payload | for |
|---|---|---|
| `shp3:price-initial` → `-additions` → `-discount` → `-final` | `{ product, price, quantity, country, config, currency, grps }` | four passes, in this order: base price, surcharges, discounts, rounding |
| `shp3:generated-items` | `{ order, items }` | shipping, fees, vouchers — lines the shop adds itself |
| `shp3:item-quantity` | `{ item, quantity }` | stock limits |
| `shp3:item-description` / `shp3:item-title` | `{ item \| product, … }` | translated or configured texts |
| `shp3:item-weight` | `{ item, weight }` | shipping weight |
| `shp3:order-check` / `:item-check` / `:product-check` | `{ …, errors }` | what blocks an order, a line, a product |
| `shp3:order-try` | `{ order, errors, prevent, redirect }` | last word before an order is placed |
| `shp3:payments` / `shp3:shippings` | `{ order, payments \| shippings }` | veto a method for this order |
| `shp3:shipping-cost` | `{ order, shipping, cost }` | what shipping costs |
| `shp3:ordered`, `shp3:ordered-after`, `shp3:paid` | `{ order }` | payment, mail, accounting — `-after` runs once payment settled |

## Payment and shipping methods

They are settings, not code: `shp3.payments.<name>.{enabled,description,sort}` — the same tree the
PHP version used. A module announces itself once with `registerMethod(app, "payments", "invoice",
"Rechnung")`, the shop enables, labels and sorts it in the backend. Shipping is added to every
open order as a generated line, carrying the highest VAT rate of the goods it moves.

## Modules in this store

| module | what |
|---|---|
| `shp3.payment.invoice` / `.advance` | payment methods |
| `shp3.shipping.pickup` | free shipping, and the only method that allows paying cash |
| `shp3.stock` | stock per product, caps orders, warns when low |
| `cms.cont.shp3.order.cart1` | the cart page |
| `cms.cont.shp3.product.default` | product page with add-to-cart |
| `cms.backend.shp3.orders1` | order list and detail |
| `cms.backend.shp3.products` | product list, inline price/weight/stock |

The module names are the PHP ones on purpose: `page.module` stores them, so an existing site keeps
working after the data migration.

## Checkout

`order.tryPlace()` is the guarded path: it re-checks every line, collects `shp3:order-check`, lets
modules stop it through `shp3:order-try`, and only then calls `place()`. `place()` itself is
unguarded — it freezes prices, VAT, shipping and payment and stamps `time_ordered` last, so
everything above it still reads the open order.

## Errors the customer can fix

`item.errors()` is checked in the cart. The one a customer can act on is a price that moved while
the goods sat there: `order.resolveItem(id)` applies the new price, and drops the line if anything
else is still wrong — the PHP fallback, without the callback machinery.

## Deviations from the PHP original

- `shp3_product_mwst` is now `shp3_product_vat`; the country default rate comes from the
  `shp3.vat.rate` setting instead of a `country` table, which qino does not have.
- Times are unix integers, not `datetime`, like the rest of qino.
- A rounding step read from an old shop carries float noise (`smallest` 0.01 arrives as
  0.009999999776 — the column was `FLOAT`). PHP never saw it because MySQL hands its driver the
  formatted string; `Currency` washes it out with six significant digits.
- Prices are `DOUBLE`, not `DECIMAL(12,4)` — item.js' schema layer emits `DECIMAL` without a
  precision, which MySQL reads as `DECIMAL(10,0)`. Rounding goes through `Currency.round()`.
- `shp3.stock` keeps the columns `stock`, `stock_is_fix` and `stock_trigger` on `shp3_product`.
  Only its settings were renamed: `notification email` → `notification_email`.
- The cart id lives in `ctx.sess.data`, not in `ctx.settings`: the latter is writable by the
  visitor, who could point their cart at someone else's order.
- The product row is created on demand (`ensureProduct`), not only by a backend "add product"
  action — a page that uses the product module is a product, however it was created.
- Countries are not a table here, so `shp3::LiveCountry()` reduces to the order's own
  ship/bill country plus the `shp3.vat.rate` default.
