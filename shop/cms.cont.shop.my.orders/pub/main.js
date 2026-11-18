import { initNode } from "@qino/m/cms/pub/js/cms.js";
import { pay } from "../../cms.shop/pub/shop.js";

initNode("cont.shop.my.orders", (el) => el.addEventListener("click", async (e) => {
  const button = e.target.closest(".-pay");
  if (!button) return;
  button.disabled = true;
  const res = await pay(button.dataset.order);
  if (res.redirect) location.href = res.redirect;
  else button.disabled = false;
}));
