// A new product: on to its page here.
import { api } from "@qino/pub/api.js";

document.addEventListener("submit", async (e) => {
  const form = e.target.closest?.("[data-create]");
  if (!form) return;
  e.preventDefault();
  const res = await api.cms.node(Number(cms.el.nid(form))).api.post({ create: Object.fromEntries(new FormData(form)) });
  if (res?.product) location.search = "?product=" + res.product;
});
