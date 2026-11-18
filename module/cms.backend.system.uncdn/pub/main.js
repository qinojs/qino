import { cms, initNode } from "@qino/m/cms/pub/js/cms.js";

initNode("backend.system.uncdn", (el) => {
  const nid = Number(cms.el.nid(el));

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    btn.disabled = true;
    cms.reloadNode(nid, { delete: btn.dataset.delete });
  });
});
