import { apt } from "../../core/pub/js/qino.js";

cms.initCont("cms.backend.superuser.uncdn", (el) => {
  const nid = Number(el.dataset.pid);

  el.addEventListener("click", async (e) => {
    const reload = e.target.closest("[data-reload]");
    const del = e.target.closest("[data-delete]");
    const btn = reload || del;
    if (!btn) return;
    btn.disabled = true;
    const vars = reload ? JSON.parse(reload.dataset.reload) : { delete: del.dataset.delete };
    el.outerHTML = await apt.cms.node(nid).html.post({ vars });
  });
});
