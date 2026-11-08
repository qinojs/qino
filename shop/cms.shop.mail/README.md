# cms.shop.mail

On `shop:ordered` the customer (billing email) gets a confirmation, `receivers` a copy. Before each
mail `shop:mail` fires with `copy` and `attachments`: an export file, an invoice PDF go in there.
