import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.shp3.products", (el) => {
  const node = apt.cms.node(Number(cms.el.nid(el)));

  el.addEventListener("change", (e) => {
    const input = e.target.closest("input.-f");
    if (!input) return;
    const id = input.closest("[itemid]")?.getAttribute("itemid");
    node.api.post({ save: id, field: input.dataset.field, value: input.value })
      .then((r) => { if (r) input.value = r.value; });
  });
});
