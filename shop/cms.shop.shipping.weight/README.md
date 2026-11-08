# cms.shop.shipping.weight

A delivery provider (`weight.<tariff>`). `shop_shipping_rate` holds the price per country, tariff
and weight limit; a parcel costs the cheapest rate above its weight, one heavier than every rate the
heaviest in proportion. `shop_shipping_free` ships for free from an amount of goods. A tariff is
offered where it has rates for the country; what the customer reads is cms.shop's `labels`.
