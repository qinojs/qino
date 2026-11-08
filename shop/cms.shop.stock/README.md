# cms.shop.stock

`stock` on `shop_product` and `shop_variant`. A product with variants is in stock as its variants
are. A line asking for more than is left is an error that names what is left; placing an order takes
its amounts off the variant, else the product.
