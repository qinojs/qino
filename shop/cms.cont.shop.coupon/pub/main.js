// Delegated on document: frontend layouts have no cms.mjs.
import { api } from "@qino/pub/api.js";

document.addEventListener("submit", async (e) => {
  const form = e.target.closest?.("[qcms-mod='cont.shop.coupon']");
  if (!form) return;
  e.preventDefault();
  const res = await api["cms.shop.coupon"].redeem.put({ code: form.elements.code?.value ?? "" });
  if (res.ok) location.reload();
  else alert(form.dataset.wrong || "?");
});
