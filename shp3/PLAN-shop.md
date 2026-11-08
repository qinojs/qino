# PLAN: shp3 → cms.shop

Entwurf zur Diskussion, keine Entscheidung. Erster echter Konsument: Lascaux (Migration von PHP).

**Stand 07.11.2026:** umgesetzt als Store `qino/shop/`, Migration in `qino/meta/migrate_shp3/`,
getestet mit Lascaux (`projects/lascaux.ch/doc/qino-test.md`). Abweichungen vom Entwurf unten:

- `ref` ist `cms.shop:<id>` (fin-Konvention `<module>:<id>`).
- Preis-Module heissen `cms.shop.price.discount` und `.price.currency`; Versand sind Provider
  wie in fin (`export const shippingProvider`), `shop:shipping-cost` entfällt.
- Generierte Zeilen heissen `extras` (`shop:extras`), Produktzeilen `lines()`.
- Checkout sind einzelne Bausteine (`cms.cont.shop.cart`, `.address`, `.shipping`, `.payment`,
  `.buy`, `.next`) statt eines `.checkout` — so bleiben die migrierten Seiten bestehen.
- Rabatte: `node_id` statt Produkt — ein Rabatt gilt für den Teilbaum, die Menge zählt über alle
  Zeilen darunter (wie `discount1` in PHP).
- Neu: `country.shop_currency` (welche Shop-Währung ein Land zahlt), Events `shop:cart`, `shop:pay`.
- Offen geblieben: Netto für Händler, AG/GmbH (fin), Kurse.

## Ziel

Ein Shop, der nur macht, was ein Shop ist: **Katalog, Warenkorb, Bestellung, Preis, Versand, Lager.**
Geld (Zahlung, Rechnung, Steuerrundung, Buchhaltung) macht fin. Produkte sind Nodes — Texte, Rechte,
online/offline, Dateien, Versionen kommen vom cms, ohne eine Zeile Shop-Code.

Was nur eine Site braucht (Lascaux: Blending, Farblinien, Fracht), sind Projektmodule über Events.

## Konventionen

| Was | Regel | Beispiel |
|---|---|---|
| Module | `cms.shop*` — der Shop hängt am cms (Paketgrenze `@qino/cms`) | `cms.shop`, `cms.shop.stock`, `cms.cont.shop.cart`, `cms.backend.shop.orders` |
| Modulnamen | ohne Versionsnummern | `cart`, nicht `cart1` / `order.cart3` |
| Tabellen | Fachwort, nicht Modulname (wie `page`, `invoice`, `form_entry`) | `shop_order`, `shop_product` |
| Events | `shop:<was>` auf der App (wie `invoice:status`, `payment:change`) | `app.on("shop:ordered", …)` |
| Settings | `app.settings["cms.shop"]` | `…["cms.shop"].taxIncluded` |
| Beträge | **Minor Units** wie fin; Stückpreise dürfen feiner sein (fin.invoice-Regel) | `4990` = CHF 49.90 |
| Steuer | Prozent, `taxRate` + `taxCategory` (EN 16931) wie fin.invoice | `8.1`, `"AE"` |
| Brutto/Netto | ein Schalter `taxIncluded` — gleiches Wort wie fin.invoice | |
| Zeiten | Unix-Sekunden, Spalten `created` / `changed` / `ordered` wie fin | |
| Adressen | Party-Form von fin (`name`, `address` schema.org) + `email`, `telephone` | `partyOf(usr)` passt direkt |
| Rows | Spalten sind Daten, Methoden sind Verben (bleibt aus shp3) | `price` vs. `pricesFor()` |
| ref | `cms.shop:<orderId>` via `refOf()` — wie `fin.invoice:<id>` | |

Was wegfällt gegenüber shp3: die eigene `Shp3`-Klasse mit eigenem Emitter (Events gehen auf die App,
wie bei fin), `shp3.payment.*`, `shp3_order_item_generated` (wird normale Zeile), Optionen
(`shp3_product_opt*`, in Lascaux-Bestellungen nie benutzt).

## Module

| cms.shop | ersetzt (qino-shp3 / Lascaux-PHP) | Inhalt |
|---|---|---|
| `cms.shop` | `shp3` | Produkt, Variante, Bestellung, Warenkorb, Preis-Pipeline, Methoden-Registry |
| `cms.shop.stock` | `shp3.stock`, Lager in `shp3.product.variant` | `stock` an Produkt + Variante, Check, Abbuchen |
| `cms.shop.discount` | `discount1`, `campaign1`, `shp3_product_discount` | Mengen-, Gruppen-(Händler-)rabatt, Aktionen — eine Tabelle |
| `cms.shop.currency` | `shp3.price_by_currency` | fester Preis je Währung statt Umrechnung |
| `cms.shop.countries` | `shp3.country.whitelist` (Produkt) | Produkt nur in gelistete Länder |
| `cms.shop.minimum` | `shp3.minimum_order_amount` | Mindestbestellwert, Kleinmengenzuschlag |
| `cms.shop.shipping.pickup` | `shp3.shipping.pickup` | Abholung |
| `cms.shop.shipping.weight` | `shipping_by_weight_and_country` | Tarif nach Gewicht und Land |
| `cms.shop.invoice` | `shp3.accounting1`, `shp3.payment.invoice` | stellt pro Bestellung eine fin.invoice aus |
| `cms.shop.mail` | `shp3.messages2` | Bestätigung an Kunde und Shop |
| `cms.cont.shop.product` / `.category` / `.cart` / `.cart.small` / `.checkout` | `cms.cont.shp3.*` | Frontend |
| `cms.backend.shop` / `.products` / `.orders` / `.settings` | `cms.backend.shp3.*` | Backend |
| `starter.shop` | bleibt | |

Zahlungsarten sind die `fin.payment.*`-Provider. „Kauf auf Rechnung" = `qrbill` (Slip auf der
fin.invoice), kein eigenes Modul.

Lascaux-Projekt (nicht im Store): `lascaux.blending` (Bestell-CSV, Lagerimport, Debitornummer),
`lascaux.colors` (Farblinien-Kategorie, `cd_*`-Spalten), `lascaux.freight`, Kurse/Warteliste (`shp3.event2`).

## Schema

```
shop_product      id (= page.id, cascade), price, weight, sku, gtin, brand
shop_variant      id, product_id, sort, price NULL, weight NULL, sku, gtin
                  — Bezeichnung = Node-Text "variant_<id>" (wie PHP), keine eigenen Nodes
shop_currency     id, factor, smallest, smallest_closing, active, main        (unverändert)
shop_product_tax  product_id, country, rate                                    (= shp3_product_mwst)
country           + shop_enabled, shop_tax_rate                                (locale.country)

shop_order        id, usr_id, status, currency, lang, shipping, payment,
                  bill (JSON party), ship (JSON party | NULL = wie bill),
                  net, tax, total, data (JSON), created, changed, ordered
shop_order_line   id, order_id, sort, key, product_id, variant_id, name, description,
                  quantity, price, tax_rate, tax_category, amount, data (JSON)

cms.shop.stock      shop_product.stock, shop_variant.stock
cms.shop.discount   shop_discount   id, node_id (0 = alle, sonst Produkt oder Kategorie-Teilbaum),
                                    grp_id (0 = alle), min_quantity, factor, start, end, title
cms.shop.currency   shop_price      product_id, variant_id (0), currency, price
cms.shop.countries  shop_product_country  product_id, country
cms.shop.shipping.weight  shop_shipping_rate  country, method, weight, price
```

- `status`: `cart` → `ordered` → `paid`; `canceled` daneben. Bezahlt folgt aus fin.payment
  (`payment:change` mit `ref` `cms.shop:<id>`), kein eigener `paid`-Betrag.
- `shop_order_line.key`: leer für Produktzeilen, sonst der Name einer generierten Zeile
  (`shipping`, `minimum`, …) — ein Modul ersetzt seine Zeile statt eine zweite anzuhängen.
- Variante ist eine Spalte (`variant_id`), nicht `config.shp3_variant`.
- Zeilen haben dieselbe Form wie `invoice_line` → Summen über `totals()` von fin.invoice, Rechnung
  ist ein 1:1-Übertrag.

## API

`@qino/cms/shop` (mod.ts):

```ts
// cart & orders
cart(ctx: Ctx, create?: boolean): Promise<Order | undefined>
order(app: App, id: number): Promise<Order | undefined>
orders(app: App, opts?: { usrId?: number; status?: Status; limit?: number }): Promise<Order[]>
refOf(id: number): string                                     // "cms.shop:12"

// products
product(app: App, id: number): Promise<Product | undefined>   // id = page.id
ensureProduct(node: Node): Promise<Product>

// shop-wide
countries(app: App): Promise<string[]>                        // marked, or all while none is
sellsTo(app: App, country: string): Promise<boolean>
country(app: App): Promise<string>                            // the shop's own
taxRate(app: App, country?: string): Promise<number>
mainCurrency(app: App): Promise<Currency | undefined>
methods(app: App, kind: "shipping"): Promise<Method[]>
payments(order: Order): Promise<Method[]>                     // fin.payment.methods ∩ settings − veto
registerShipping(app: App, name: string, label: string): Promise<void>

type Status = "cart" | "ordered" | "paid" | "canceled";
type Method = { name: string; label: string };
type Party = { name: string; email?: string; telephone?: string; address: Record<string, string> };
```

Rows:

```ts
class Product {
  id; price; weight; sku; gtin; brand                        // columns
  node(): Promise<Node>
  title(lang?: string): Promise<string>
  variants(): Promise<Variant[]>
  taxRateFor(country: string): Promise<number>
  pricesFor(q: PriceQuery): Promise<{ net: number; gross: number }>
  errors(variant?: Variant): Promise<Errors>
}

class Variant {
  id; product_id; sort; price; weight; sku; gtin
  product(): Promise<Product>
  title(lang?: string): Promise<string>                      // node text "variant_<id>"
}

class Order {
  id; usr_id; status; currency; lang; shipping; payment; bill; ship; net; tax; total; data; created; ordered
  lines(): Promise<Line[]>                                   // products and generated, by sort
  add(product: Product | number, opts?: { variant?: number; quantity?: number; data?: unknown }): Promise<Line>
  remove(line: Line | number): Promise<void>
  setCurrency(id: string): Promise<this>
  setAddress(kind: "bill" | "ship", party: Party | null): Promise<this>
  shipCountry(): string
  weight(): Promise<number>
  grps(): Promise<number[]>
  shippings(): Promise<Method[]>
  shippingCost(name?: string): Promise<number>
  totals(): Promise<{ net: number; tax: number; total: number; taxes: Record<string, number> }>
  errors(): Promise<Errors>
  place(): Promise<{ ok: boolean; errors: Errors; redirect: string }>   // checks, then freezes
  pay(opts?: { method?: string; return?: string }): Promise<{ redirect: string }>  // via fin.payment
  cancel(): Promise<this>
}

class Line {
  id; order_id; sort; key; product_id; variant_id; name; description; quantity; price; tax_rate; tax_category; amount; data
  order(): Promise<Order>
  product(): Promise<Product | undefined>
  variant(): Promise<Variant | undefined>
  setQuantity(n: number): Promise<this>                      // re-prices
  setData(data: unknown): Promise<this>                      // re-prices
  weight(): Promise<number>
  errors(): Promise<Errors>
}

type PriceQuery = { variant?: Variant; quantity?: number; country?: string; currency?: Currency;
                    usrId?: number; grps?: number[]; data?: unknown; time?: number };
type Errors = Record<string, string>;
```

Gegenüber shp3 umbenannt: `itemAdd/itemRemove` → `add/remove`, `items/generatedItems` → `lines`,
`costs` → `totals` (wie fin), `tryPlace/place` → `place` (das Ungeprüfte bleibt privat),
`vatRate*` → `taxRate*`, `allowedPayments/Shippings` → `payments()/shippings()`.

## Events

Alle auf der App, Payload ist ein veränderbares Objekt (wie heute).

| Event | Payload | Zweck |
|---|---|---|
| `shop:price-initial` → `-additions` → `-discount` → `-final` | `{ product, variant?, price, quantity, country, currency, usrId, grps, data, time }` | Basispreis, Zuschläge, Rabatt, Rundung |
| `shop:product-check` / `shop:line-check` / `shop:order-check` | `{ …, errors }` | was blockiert |
| `shop:line-quantity` | `{ line, quantity }` | Lager, Gebinde |
| `shop:line-weight` / `shop:line-description` | `{ line, weight \| description }` | |
| `shop:lines` | `{ order, lines }` | generierte Zeilen (Versand, Zuschlag, Gutschein) |
| `shop:shippings` / `shop:payments` | `{ order, methods }` | Veto je Bestellung (z. B. Rechnung nur für Händler) |
| `shop:shipping-cost` | `{ order, shipping, cost }` | |
| `shop:place` | `{ order, errors, prevent, redirect }` | letztes Wort vor dem Platzieren |
| `shop:ordered` | `{ order }` | Mail, Rechnung, Blending-CSV, Lager |
| `shop:status` | `{ order, from }` | einmal pro Statuswechsel (wie `invoice:status`) |

`shop:paid` entfällt: `shop:status` mit `status === "paid"`.

## Preise und Rabatte

- Die vier Durchgänge bleiben — sie sind das Beste an shp3.
- **Rabatte stapeln nicht: der beste gewinnt.** `cms.shop.discount` sucht alle passenden Zeilen
  (Produkt/Teilbaum, Gruppe, Menge, Zeitraum) und nimmt den kleinsten `factor`. Damit sind
  Händlerstufe (Gruppe, `node_id` 0), Mengenrabatt und Aktion ein Mechanismus, und die
  Lascaux-Falle „Händlerrabatt addiert sich zur Aktion" gibt es nicht.
- Händler = Gruppe (`usr_grp`). Netto für Händler = `shop:price-final` oder eine Gruppen-Einstellung — offen.
- Rabatte lesen ohne Zusatzabfrage pro Produkt: Tabelle klein, einmal pro Request bzw. gecacht.

## fin

- `place()` → Status `ordered`; `pay()` → `fin.payment.create({ ref: refOf(id), amount: total, … })`.
- `payment:change` → `cms.shop` setzt `paid`, feuert `shop:status`.
- `cms.shop.invoice`: auf `shop:ordered` `fin.invoice.create({ ref, party: bill, lines })` + `issue()`;
  die Zahlung läuft dann über die Rechnung (`fin.invoice:<id>`), Kauf auf Rechnung = qrbill-Slip.
- Kunden sind Benutzer (fin: „Parties are users"). Debitornummer = Spalte am `usr` (Projekt).
- Steuer: Satz und Kategorie kommen vom Shop (Land, Produkt), gerundet wird von fin (`totals()`),
  Reverse Charge = `taxCategory: "AE"`.

## Migration Lascaux (`migrate_from_php`)

| PHP | qino |
|---|---|
| `shp3_product` | `shop_product` (+ `cd_*` → Lascaux-Tabelle, `stock`, `dim_*` → offen) |
| `shp3_product_variant` | `shop_variant`, gleiche ids (Node-Texte `variant_<id>` bleiben gültig) |
| `shp3_product_price_by_currency` | `shop_price` |
| `shp3_discount1`, `shp3_campaign1`, `shp3_product_discount` | `shop_discount` |
| `shp3_product_country_whitelist` | `shop_product_country` |
| `shp3_shipping_by_weight_and_country` | `shop_shipping_rate` |
| `shp3_order` | `shop_order`: datetime → unix, `bill_*`/`ship_*` → party-JSON, Beträge → minor, Status aus `time_ordered`/`time_paid` |
| `shp3_order_item` + `_generated` | `shop_order_line`; `config.shp3_variant` → `variant_id` |
| `shp3_product_opt*`, `*_bak`, `country_blacklist` | entfallen |

Mengen: 473 Produkte, 1381 Varianten, 2577 Bestellungen, ~23 700 Zeilen.

## Reihenfolge

1. Umbenennen shp3 → cms.shop (Store-Ordner `shop/`), Events auf die App, Tests mitziehen.
2. Schema: Variante, Zeilen vereinheitlicht, Party-Adressen, Minor Units, Status.
3. fin-Anbindung: `pay()`, `payment:change`, `totals()`, `cms.shop.invoice`.
4. Module: stock, discount, currency, countries, minimum, shipping.weight.
5. Migration Lascaux + Projektmodule.

## Offen

- **`ref`:** `cms.shop:<id>` (Modulname, wie `fin.invoice:<id>`) oder `shop.order:<id>` (so steht es als
  Beispiel in fin)?
- **Netto für Händler:** Gruppen-Einstellung im Shop oder Projektmodul?
- **Währungen:** `shop_currency` bleibt Shop-Sache, oder gehört Rundung/Faktor zu fin (`mainCurrency` gibt es dort schon)?
- **AG/GmbH:** mehrere Gesellschaften sind eher eine fin-Frage (Absender der Rechnung) als eine Shop-Frage.
- **Masse (`dim_*`):** in `shop_product` (strukturierte Daten, Versand) oder Projekt?
- **Kurse/Warteliste** (`shp3.event2`, 482 Bestellzeilen): Projekt oder später generisch?
