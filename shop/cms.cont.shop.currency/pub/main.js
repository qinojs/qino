// Delegated on document.
import { setCurrency } from "../../cms.shop/pub/shop.js";

document.addEventListener("change", async (e) => {
  const select = e.target.closest?.("[qcms-mod='cont.shop.currency'] select");
  if (select) { await setCurrency(select.value); location.reload(); }
});
