cms.initNode("cont.example.ml", (el) => {
  const nid = cms.el.nid(el);
  el.addEventListener("click", (e) => {
    if (e.target.closest(".-reload")) cms.reloadPart(nid, "teaser");
  });
});
