// Delegated on document: frontend layouts have no cms.mjs.
import { api } from "@qino/pub/api.js";

import { reload } from "../../cms.shop/pub/shop.js";

const root = "[qcms-mod='cont.shop.next']";

document.addEventListener("click", (e) => {
  const button = e.target.closest?.(`${root} button[data-href]`);
  if (!button) return;
  e.preventDefault();
  const errors = JSON.parse(button.closest(root).dataset.errors || "[]");
  if (button.classList.contains("-next") && errors.length) return alert(errors[0]);
  location.href = button.dataset.href;
});

// what blocks going on follows the cart
api.on("POST|PUT|DELETE cms.shop/cart/*", () => document.querySelectorAll(root).forEach(reload));
