import { cms, initNode } from "@qino/m/cms/pub/js/cms.js";

initNode("cont.example", (el) => {
  const nid = cms.el.nid(el);
  el.addEventListener("click", () => cms.reloadPart(nid, "teaser"));
});
