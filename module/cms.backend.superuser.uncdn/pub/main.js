import { api } from "@qino/pub/qino.js";

cms.initNode("backend.superuser.uncdn", (el) => {
  const nid = Number(cms.el.nid(el));

  el.addEventListener("click", async (e) => {
    const reload = e.target.closest("[data-reload]");
    const del = e.target.closest("[data-delete]");
    const btn = reload || del;
    if (!btn) return;
    btn.disabled = true;
    const vars = reload ? JSON.parse(reload.dataset.reload) : { delete: del.dataset.delete };
    el.outerHTML = await api.cms.node(nid).html.post({ vars });
  });
});
