import { api } from "@qino/pub/api.js";
import { cms, initNode } from "@qino/m/cms/pub/js/cms.js";

initNode("cont.shop.next", (el) => el.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-href]");
  if (!button) return;
  e.preventDefault();
  const errors = JSON.parse(el.dataset.errors || "[]");
  if (button.classList.contains("-next") && errors.length) return alert(errors[0]);
  location.href = button.dataset.href;
}));

// what blocks going on follows the cart — one listener per page
api.on("POST|PUT|DELETE cms.shop/cart/*", () => document.querySelectorAll("[qcms-mod='cont.shop.next']").forEach((el) => cms.reloadNode(cms.el.nid(el))));
