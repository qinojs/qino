import { apt } from "../../core/pub/js/qino.js";

cms.initNode("cont.shp3.product.default", (el) => {
  const node = apt.cms.node(Number(cms.el.nid(el)));

  el.addEventListener("submit", (e) => {
    const form = e.target.closest("form.-add");
    if (!form) return;
    e.preventDefault();
    if (!form.reportValidity()) return;
    node.api.post({ add: 1, quantity: form.elements.quantity?.value ?? 1 })
      .then((r) => { if (r) el.dispatchEvent(new CustomEvent("shp3:added", { detail: r, bubbles: true })); });
  });
});
