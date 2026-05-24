cms.initCont("cms.cont.example.ml", (el) => {
  const nid = cms.el.pid(el);
  el.addEventListener("click", (e) => {
    if (e.target.closest(".-reload")) cms.reloadPart(nid, "teaser");
  });
});
