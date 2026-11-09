// Delegated on document: frontend layouts have no cms.mjs.
import { pay } from "../../cms.shop/pub/shop.js";

document.addEventListener("click", async (e) => {
  const button = e.target.closest?.("[qcms-mod='cont.shop.my.orders'] .-pay");
  if (!button) return;
  button.disabled = true;
  const res = await pay(button.dataset.order);
  if (res.redirect) location.href = res.redirect;
  else button.disabled = false;
});
