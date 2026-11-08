# cms.shop.invoice

On `shop:ordered` an invoice is created from the order's lines, one to one, and issued; its `ref`
is the order's. A payment started for the order settles the invoice instead, and once the invoice
is paid, so is the order. Paying by invoice is fin's QR bill on that invoice, no method of its own.
