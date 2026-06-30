cms.initNode("backend.ai.sessions", (el) => {
  const nid = Number(cms.el.nid(el));
  const search = el.querySelector("#aiSessionSearch");
  let timer;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => cms.reloadPart(nid, "list", { search: search.value }), 250);
  });
});
