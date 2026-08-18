cms.initNode("backend.superuser.shorturl", (el) => {
  const nid = Number(cms.el.nid(el));
  const search = el.querySelector("[data-search]");
  let sort = "", dir = "desc", page = 0, timer;

  // the list keeps its own state (search, sort, page) — reload it, not the whole node
  const reloadList = (vars) => cms.reloadPart(nid, "list", { search: search.value, sort, dir, page, ...vars });
  // a new search or sort order starts at the top again
  search?.addEventListener("input", () => { clearTimeout(timer); page = 0; timer = setTimeout(reloadList, 250); });

  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target.closest("[data-create]");
    if (form) cms.reloadNode(nid, { create: Object.fromEntries(new FormData(form)) });
  });

  el.addEventListener("click", (e) => {
    const th = e.target.closest("[data-sort]");
    if (th) { sort = th.dataset.sort; dir = th.dataset.dir; page = 0; reloadList(); return; }

    const pager = e.target.closest("[data-page]");
    if (pager) { page = Number(pager.dataset.page); reloadList(); return; }

    const del = e.target.closest("[data-delete]");
    if (del) { e.preventDefault(); del.disabled = true; reloadList({ delete: del.dataset.delete }); }
  });
});
