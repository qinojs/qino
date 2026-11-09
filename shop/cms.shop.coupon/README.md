# cms.shop.coupon

`shop_coupon`: a code takes a percentage off the regular prices or an amount off the order, for the
products below `node_id` or all of it, between `start` and `end`. An amount (`money`) is used up by
what it paid, unless it is `constant`. `once` holds per user and per email. The order keeps its code
(`shop_order.coupon`); the discount is a line of its own. API: `cms.shop.coupon/redeem`.
