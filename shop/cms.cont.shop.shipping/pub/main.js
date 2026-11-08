// Delegated on document: frontend layouts have no cms.mjs.
import { choose } from "../../cms.shop/pub/shop.js";

document.addEventListener("change", (e) => {
  const input = e.target.closest?.("[qcms-mod='cont.shop.shipping'] [name=method]");
  if (input) choose("shipping", input.value);
});
