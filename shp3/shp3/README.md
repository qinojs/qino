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
calculation beside it is `pricesFor()`; `vat_rate` is a column, so the live rate is `calcVatRate()`.
A method that collides with a column name throws at boot.

## Extension points

Everything variable is an app event, not a subclass:

| event | payload | for |
|---|---|---|
| `shp3:price-initial` → `-additions` → `-discount` → `-final` | `{ product, price, quantity, country, config, currency, grps, time }` | four passes, in this order: base price, surcharges, discounts, rounding. `time: 0` asks for the price before any time-limited offer |
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

## Countries and VAT

The list itself is not the shop's business — it comes from `locale.country`. shp3 marks the rows it
sells to (`shp3_enabled`) and hangs its rate on them (`shp3_default_vat_rate`), both maintained in
`cms.backend.shp3.settings`, next to the currency table. A product may still carry its own rate per country in
`shp3_product_mwst`; that one wins.

While no country is marked the shop sells everywhere — nothing has to be configured to run one.
`shp3.location.country` says where the shop stands: it is the country a price is calculated for
until the customer names one, and it stands in for `shp3::LiveCountry()` of the PHP version.

## Currencies

`shp3_currency` stays the shop's own: which currencies it offers, the rounding steps, which one is
main — and `factor`, always relative to the main currency. The world's rates live in
`locale.currency`. If that module fetches them (`never`/`daily`/`hourly`), every factor follows on
each run and the shop panel stops offering them for editing; with fetching off they are the shop's
to set, as in the PHP original.

## Client side

`shp3/pub/shp3.js` is shared by every shop page. It needs no wiring:

- a `[shp3-add]` form adds to the cart from **anywhere** — a category page, a teaser, a sidebar.
  `name=product_id` names the product, every other field becomes the configuration, and an
  `action` attribute redirects afterwards.
- `[shp3-price=gross|net]` inside such a form follows the amount live, debounced.

Nothing announces changes on its own — apt does. Whoever wants to follow the cart listens to the
call itself, no matter who made it:

```js
apt.on("POST|PUT shp3/cart/*", ({ value }) => badge.set(value.cart.quantity));
```

The API behind it (`/api/shp3/…`) is page-independent on purpose — every cart operation lives
there, so a mini cart can change an amount just as well as the cart page can:

| | |
|---|---|
| `GET cart` | items, quantity, net, gross, currency |
| `POST cart/items` | add a product |
| `PUT/DELETE cart/items/:id` | change the amount (zero removes) / remove |
| `POST cart/items/:id/solve` | take over a moved price, or drop the line |
| `PUT cart/shipping` · `cart/payment` · `cart/currency` · `cart/address` | |
| `POST cart/order` | place it |
| `POST price` | what a product costs right now |

A line id from the request is always looked up **in the visitor's own cart** — never fetched
directly.

## Modules in this store

| module | what |
|---|---|
| `shp3.payment.invoice` / `.advance` | payment methods |
| `shp3.shipping.pickup` | free shipping, and the only method that allows paying cash |
| `shp3.stock` | stock per product, caps orders, warns when low |
| `shp3.messages2` | the order confirmation, to the customer and/or the shop |
| `cms.cont.shp3.product.default` | product page with add-to-cart |
| `cms.cont.shp3.order.cart1` | the cart page |
| `cms.cont.shp3.order.addresses2` | billing and delivery address |
| `cms.cont.shp3.order.shipping` / `.payment` | method choice |
| `cms.cont.shp3.order.buy1` | the buy button, and what still blocks it |
| `cms.cont.shp3.category1` | product list, each item with its own add-to-cart form |
| `cms.cont.shp3.order.cart.small` | the cart in the corner, reloading on any cart call |
| `cms.backend.shp3.orders1` | order list and detail |
| `cms.backend.shp3.products` | product list, inline price/weight/stock |
| `cms.backend.shp3` | the shop overview — every page above shows its numbers as a dashboard widget |
| `cms.backend.shp3.settings` | shop address, currencies, VAT, and the countries it delivers to |

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

## After the order

`shp3.messages2` listens to `shp3:ordered` and mails the confirmation. It — like every listener on
that event — **swallows its own failure**: the order is placed and saved by the time the event
fires, so a missing mail transport is a log line, never a failed checkout.

## Deviations from the PHP original

- Countries come from `locale.country`; shp3 only marks the rows it sells to (`shp3_enabled`)
  and hangs its rate on them (`shp3_default_vat_rate`) — the same two columns the PHP version added.
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
- The product row is created on demand (`ensureProduct`) while a page renders as a product, not
  only by a backend "add product" action. The frontend API never creates one: a page becomes a
  product by being rendered as one, never by being named in a request.
- A product is whatever node carries the product module — page or container. An old shop nests
  its products as containers below the category, a new one may use pages.
- A title that was never translated is an empty string, not a missing row, so every lookup falls
  through to the default language explicitly.
- `shp3::LiveCountry()` reduces to the order's own ship/bill country, falling back to
  `shp3.location.country` — no detection by IP, no user profile.
