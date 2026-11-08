# cms.shop.price.discount

One table for every kind of discount, `shop_discount`: a row holds for the products below `node_id`
(0: all), for the members of `grp_id` (0: everybody), from `min_quantity` units on, between `start`
and `end` (0: open). Quantity discount, dealer level and action are the same mechanism.

**The best discount wins, discounts never add up.** A dealer on 30 % does not get the action's
20 % on top. The amount is counted over all lines of the cart below the discount's node: three
colours of one range make the quantity together. A reduced price lands on the currency's
`rounding` step.
