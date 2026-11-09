# cms.shop.shipping.product

A delivery provider (`product`). `shop_shipping_product` holds rates per product and amount: a line
ships for the rate of the highest `min_quantity` it reaches, the order for the sum of its lines. Made
for print and the like, where 100 cards ship as a letter and 5000 as a parcel. Offered as soon as a
product of the order has rates; what the customer reads is cms.shop's `labels`.
