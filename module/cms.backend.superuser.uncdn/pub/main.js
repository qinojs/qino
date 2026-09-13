import { api } from "@qino/pub/api.js";

cms.initNode("backend.superuser.uncdn", (el) => {
  const nid = Number(cms.el.nid(el));

  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    btn.disabled = true;
    el.outerHTML = await api.cms.node(nid).html.post({ vars: { delete: btn.dataset.delete } });
  });
});
