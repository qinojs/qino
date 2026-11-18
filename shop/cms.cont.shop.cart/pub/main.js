// Delegated on document.
import { api } from "@qino/pub/api.js";

import { remove, setQuantity, solve } from "../../cms.shop/pub/shop.js";
import { cms } from "@qino/m/cms/pub/js/cms.js";

const root = "[qcms-mod='cont.shop.cart'] ";
const lineOf = (target) => target.closest("[data-line]")?.dataset.line;

// whatever changed the cart changes prices, discounts and shipping here too
api.on("POST|PUT|DELETE cms.shop/cart/*", () => document.querySelectorAll("[qcms-mod='cont.shop.cart']").forEach((el) => cms.reloadNode(cms.el.nid(el))));

document.addEventListener("change", (e) => {
  const input = e.target.closest?.(root + ".-quantity input");
  if (input) setQuantity(lineOf(input), Number(input.value));
});
document.addEventListener("click", (e) => {
  const button = e.target.closest?.(root + "[data-line] button");
  if (!button) return;
  const { solution } = button.dataset;
  solution ? solve(lineOf(button), solution) : remove(lineOf(button));
});
