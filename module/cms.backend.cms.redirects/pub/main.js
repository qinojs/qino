cms.initNode("backend.cms.redirects", (el) => {
  const nid = Number(cms.el.nid(el));
  const search = el.querySelector("[data-search]");
  let sort = "", dir = "desc", broken = false, timer;

  // reload only the list part (it keeps search, sort, filter)
  const reloadList = (vars) => cms.reloadPart(nid, "list", { search: search.value, sort, dir, broken, ...vars });
  search?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(reloadList, 250); });

  el.addEventListener("submit", (e) => {
    e.preventDefault();
    cms.reloadNode(nid, { create: Object.fromEntries(new FormData(e.target.closest("[data-create]"))) });
  });

  // A cell saves on blur; the reload updates the badges.
  el.addEventListener("change", (e) => {
    const tr = e.target.closest("[data-request], [data-target]")?.closest("tr");
    if (tr) reloadList({ save: {
      from: tr.dataset.from,
      request: tr.querySelector("[data-request]").value,
      redirect: tr.querySelector("[data-target]").value,
    } });
  });

  el.addEventListener("click", (e) => {
    const th = e.target.closest("[data-sort]");
    if (th) { sort = th.dataset.sort; dir = th.dataset.dir; reloadList(); return; }

    const filter = e.target.closest("[data-broken]");
    if (filter) { broken = filter.dataset.broken === "1"; reloadList(); return; }

    const del = e.target.closest("[data-delete]");
    if (del) { e.preventDefault(); del.disabled = true; reloadList({ delete: del.dataset.delete }); }
  });
});
