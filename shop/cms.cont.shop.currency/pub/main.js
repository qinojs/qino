import { initNode } from "@qino/m/cms/pub/js/cms.js";
import { setCurrency } from "../../cms.shop/pub/shop.js";

initNode("cont.shop.currency", (el) => el.addEventListener("change", async (e) => {
  const select = e.target.closest("select");
  if (select) { await setCurrency(select.value); location.reload(); }
}));
