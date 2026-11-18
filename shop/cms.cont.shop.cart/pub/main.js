import { api } from "@qino/pub/api.js";
import { cms, initNode } from "@qino/m/cms/pub/js/cms.js";
import { remove, setQuantity, solve } from "../../cms.shop/pub/shop.js";

const lineOf = (target) => target.closest("[data-line]")?.dataset.line;

// whatever changed the cart changes prices, discounts and shipping here too — one listener per page
api.on("POST|PUT|DELETE cms.shop/cart/*", () => document.querySelectorAll("[qcms-mod='cont.shop.cart']").forEach((el) => cms.reloadNode(cms.el.nid(el))));

initNode("cont.shop.cart", (el) => {
  el.addEventListener("change", (e) => {
    const input = e.target.closest(".-quantity input");
    if (input) setQuantity(lineOf(input), Number(input.value));
  });
  el.addEventListener("click", (e) => {
    const button = e.target.closest("[data-line] button");
    if (!button) return;
    const { solution } = button.dataset;
    solution ? solve(lineOf(button), solution) : remove(lineOf(button));
  });
});
