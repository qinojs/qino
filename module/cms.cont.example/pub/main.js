cms.initCont("cms.cont.example", (el) => {
  el.addEventListener("click", () => cms.reloadPart(cms.el.pid(el), "teaser"));
});
