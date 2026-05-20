cms.initCont("cms.cont.example", (el) => {
  const nid = cms.el.pid(el);
  el.addEventListener("click", () => cms.reloadPart(nid, "teaser"));
});
