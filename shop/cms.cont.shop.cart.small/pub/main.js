// Delegated on document: frontend layouts have no cms.mjs.
import { api } from "@qino/pub/api.js";

import { reload } from "../../cms.shop/pub/shop.js";

// whatever touched the cart: a product page, a category, another script
api.on("POST|PUT|DELETE cms.shop/cart/*", () => document.querySelectorAll("[qcms-mod='cont.shop.cart.small']").forEach(reload));
