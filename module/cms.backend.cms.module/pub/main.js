import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.cms.module", (el) => {
  const nid = Number(cms.el.nid(el));

  // save access level on change
  el.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-access]");
    if (!sel) return;
    apt.cms.node(nid).html.post({ vars: { set_access: sel.dataset.access, access: sel.value } });
  });
});
