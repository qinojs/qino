# cms.shop.minimum

`minimum` and `minimum_surcharge` on `shop_currency`, in that currency's minor units, with tax:
goods worth less than the minimum add the surcharge as a line of its own, taxed as the country is.
Products below the nodes in `exclude` (courses, vouchers) do not count.
