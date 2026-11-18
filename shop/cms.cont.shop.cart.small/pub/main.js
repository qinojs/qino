import { api } from "@qino/pub/api.js";

import { cms } from "@qino/m/cms/pub/js/cms.js";

// whatever touched the cart: a product page, a category, another script
api.on("POST|PUT|DELETE cms.shop/cart/*", () => document.querySelectorAll("[qcms-mod='cont.shop.cart.small']").forEach((el) => cms.reloadNode(cms.el.nid(el))));
