# starter.shop

A shop on top of [starter.cms](../../module/starter.cms/README.md).

- *Shop* with three sample products and a small cart, *Cart*, and below it *Checkout*
  (address, shipping, payment, order) and the thank-you page.
- An invoice per order, payable by QR bill once an IBAN is set, pickup as shipping method, the order
  confirmation by mail.
- The shop backend: orders, products, settings.

Products are contents of the category, so each is listed with its own add-to-cart form. It needs
the stores `shop/` and `fin/`.
