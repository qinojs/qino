cms.initNode("cont.example", (el) => {
  const nid = cms.el.nid(el);
  el.addEventListener("click", () => cms.reloadPart(nid, "teaser"));
});
