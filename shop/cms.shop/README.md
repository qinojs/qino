# cms.shop

The shop: **catalogue, cart, order, price, delivery.** Money is fin's business — payment
(fin.payment), invoice and tax rounding (fin.invoice). Products are pages: texts, rights,
online/offline, files and versions come from the cms.

```ts
import { cart } from "@qino/qino/cms.shop";

const order = await cart(ctx);                        // the visitor's, created on demand
await order.add(product, { variant, quantity: 2 });
await order.setParty("bill", { name: "Anna Muster", email: "anna@example.ch", address: { addressCountry: "CH" } });
const { ok, errors } = await order.place();
const { redirect } = await order.pay({ return: "/done" }); // fin.payment, ref cms.shop:<id>
```

A placed order stands even if its payment does not start: the API answers `paymentFailed`, and
`order/:id/pay` tries again, for the customer's own order or one placed in this session.

## Conventions

| | |
|---|---|
| Tables, events | `shop_*`, `shop:*` — the trade word, not the module name |
| Amounts | minor units, as fin: 2450 is CHF 24.50; unit prices may be finer |
| Tax | `taxRate` in percent, `taxCategory` (EN 16931); prices with tax if `taxIncluded` |
| Parties | fin's shape (`name`, `address` as schema.org) plus `email`, `telephone` |
| `ref` | `cms.shop:<id>` (`refOf`, `idOf`) — what payments and invoices of an order carry |
| Rows | columns are data, methods are verbs: `price` vs. `prices()` |

## Rows

`Product` (id = page id), `Variant` (its name is the text `variant_<id>` of the product's page),
`Order`, `Line`, `Currency`. A product with variants is sold as one of them, never by itself. An open
order is a cart (`status` `cart`); `place()` takes the country of the delivery address, freezes its lines
and adds the lines the shop computed (`extras`: shipping, surcharges) as lines of their own, then
it is `ordered`, and `paid` once fin says the payments with its ref cover the total.

## Events

| Event | Payload | For |
|---|---|---|
| `shop:price-initial` → `-additions` → `-discount` → `-final` | `{ product, line, variant, price, quantity, order, currency, country, usrId, data, time }` | a unit price in four passes |
| `shop:product-check`, `shop:line-check`, `shop:order-check` | `{ …, errors }` | what blocks; a line's check may add `solutions` (id → `{ label, solve }`), buttons next to the error |
| `shop:product-fields` | `{ product, order, currency, fields }` | what a buying form asks besides the amount (`product.fields()`) |
| `shop:line-quantity`, `shop:line-weight`, `shop:line-description` | `{ line, … }` | stock, packaging, texts |
| `shop:extras` | `{ order, extras }` | lines the shop adds itself; same key replaces |
| `shop:shippings`, `shop:payments` | `{ order, methods }` | take out what does not fit this order |
| `shop:cart`, `shop:place`, `shop:pay` | | a new cart, the last word before placing, what a payment settles |
| `shop:ordered`, `shop:status` | `{ order }`, `{ order, previous }` | mail, invoice, stock, export; once per change |

## Extending

A shop module changes nothing in cms.shop, it adds:

| What | How | Example |
|---|---|---|
| Behaviour | listens with `const on = listen(app, signal)` to the events above | stock, discount, coupon |
| Columns | a `dbSchema` on the shop's tables, typed with `declare module "@qino/qino/cms.shop"` | `stock`, `coupon`, `rent_interval` |
| What a customer picks | the line's data, one key per module | `options`, `rent` |
| Lines of its own | an extra with its key (`shop:extras`) | `minimum`, `coupon`, `rounding` |
| Delivery | `export const shippingProvider` | shipping.weight, a site's freight |
| A way out of an error | `solutions` in `shop:line-check` | stock, rent |
| What a buying form asks | `shop:product-fields` | options |

Helpers for them: `listen`, `listOf` (a list setting), `grpsOf` (core's groups), `orderTable` (an order as html),
`methodStep` (a checkout step that chooses a method).

## Delivery and payment

Payment methods are fin.payment's providers (`saferpay.twint`, `qrbill`); `payments` lists the
ones offered, in order (empty: all). Delivery works the same way: a module declares
`export const shippingProvider` (`name`, `methods` that fit an order, `all` there are, `cost` in
minor units of the main currency) —
[shipping.weight](../cms.shop.shipping.weight/), [shipping.pickup](../cms.shop.shipping.pickup/),
or a site's own. `shippings` lists the methods offered.

What the customer reads for a method is `labels` → method → language (`labels["weight.a"].de`:
"Priority"); without one, the provider's name.

## Products on pages

A product directly in a category has an address of its own, from the page and its title: the
category module says `childUrls`, and shows that product alone there. On a page of its own, it has
the page's. `productUrl(product)` is either.

## Texts

Every shop module translates in one namespace, `cms.shop` (`shopT(app)`, its `locale/`).

## Countries and currencies

The country an order goes to decides its tax (`country.shop_tax_rate`, a product may have its own
in `shop_product_tax`) and its currency: `country.shop_currency`, else the country's own if the
shop offers it, else the main one. `shop_currency` holds the shop's currencies with their
`factor` to the main one (synced from locale.currency's rates), `rounding`, the step a reduced
price lands on, and `closing`, the step the total to pay lands on: 5 is 0.05 CHF, the difference is
a line of its own (`rounding`), without tax.

Every price asks for these: `country`, `shop_currency` and `shop_product_tax` are read once per app
and again after a write through their table (`table.update()`, not a raw `db.exec`). An `Order`
keeps its lines, extras and methods until it changes; `cart(ctx)` makes it forget once per request.
