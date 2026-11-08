// Delegated on document: frontend layouts have no cms.mjs.
import { api } from "@qino/pub/api.js";

import { reload, remove, setQuantity } from "../../cms.shop/pub/shop.js";

const root = "[qcms-mod='cont.shop.cart'] ";
const lineOf = (target) => target.closest("[data-line]")?.dataset.line;

// whatever changed the cart changes prices, discounts and shipping here too
api.on("POST|PUT|DELETE cms.shop/cart/*", () => document.querySelectorAll("[qcms-mod='cont.shop.cart']").forEach(reload));

document.addEventListener("change", (e) => {
  const input = e.target.closest?.(root + ".-quantity input");
  if (input) setQuantity(lineOf(input), Number(input.value));
});
document.addEventListener("click", (e) => {
  const button = e.target.closest?.(root + "[data-line] button");
  if (button) remove(lineOf(button));
});
