# cms.shop.options

A product asks for options: `shop_option` names them, `shop_option_value` lists what can be picked
and what it costs on top (minor units of the main currency). A surcharge per unit counts in the
discount, one with `per_line` is charged once per line, after it. The picked values travel in the
line's data, `{ options: { "With box": "yes" } }`, the form's `options[With box]` fields. A line
without a value for every option, or with one the product does not offer, cannot be ordered.
