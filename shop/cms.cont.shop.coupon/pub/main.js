import { api } from "@qino/pub/api.js";
import { initNode } from "@qino/m/cms/pub/js/cms.js";

initNode("cont.shop.coupon", (form) => form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api["cms.shop.coupon"].redeem.put({ code: form.elements.code?.value ?? "" });
  if (res.ok) location.reload();
  else alert(form.dataset.wrong || "?");
}));
