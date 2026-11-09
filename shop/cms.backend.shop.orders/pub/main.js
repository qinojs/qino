import { api } from "@qino/pub/api.js";

cms.initNode("backend.shop.orders", (el) => {
  const nid = Number(cms.el.nid(el));
  el.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-status]");
    if (!button) return;
    button.disabled = true;
    const { order } = button.closest("[data-order]").dataset;
    await api.cms.node(nid).api.post({ order, status: button.dataset.status });
    cms.reloadNode(nid, { order });
  });
});
