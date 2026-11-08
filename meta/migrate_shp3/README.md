# migrate_shp3

Brings the shop of a PHP CMS site (`shp3`, also qino's port of it) into `cms.shop`, once, on install.
Register it after `migrate_from_php` and after the shop modules whose data it carries over
(`cms.shop.stock`, `.price.discount`, `.price.currency`, `.countries`, `.minimum`,
`.shipping.weight`, `.mail`) — what a module is missing for is left out. The legacy tables stay.

| shp3 | cms.shop |
|---|---|
| `shp3_product`, `shp3_product_variant` | `shop_product`, `shop_variant` (same ids; `mpn` → `sku`, `dim_*` → `length/width/height`) |
| `shp3_currency` | `shop_currency` (`smallest` → `rounding`) |
| `shp3_product_price_by_currency` | `shop_price` |
| `shp3_discount1`, `shp3_product_discount`, `shp3_campaign1` | `shop_discount` |
| `shp3_product_country_whitelist` | `shop_product_country` |
| `shp3_shipping_by_weight_and_country` + `free_from` | `shop_shipping_rate`, `shop_shipping_free` |
| `currency.shp3_minimum_order_amount(_surcharge)` | `shop_currency.minimum(_surcharge)` |
| `shp3_order`, `shp3_order_item(_generated)` | `shop_order`, `shop_order_line` — placed orders only; `bill_*`/`ship_*` → party JSON |
| `shp3.*` settings | `cms.shop.*` (`by_weight_and_country_a` → `weight.a`, `saferpay.VISA` → `saferpay.visa`) |
| page modules `cms.cont.shp3.*`, `cms.backend.shp3*` | `cms.cont.shop.*`, `cms.backend.shop*`, settings under the new keys |

Amounts become minor units; legacy line prices were net, so migrated orders keep `tax_included`
false. The charged total (`cost`) is kept as it was, even where the lines would round differently.
Payments of old orders are not recreated in fin.payment — the status (`paid`) is.
