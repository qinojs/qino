cms.initNode("backend.superuser.log", (el) => {
  const nid = Number(cms.el.nid(el));

  // live filter → reload only the list part
  const filterForm = el.querySelector("[data-filter]");
  const reloadList = () => {
    const filter = Object.fromEntries(new FormData(filterForm));
    // datetime-local is in the browser's TZ → convert to UTC unix seconds here
    for (const k of ["from", "to"]) if (filter[k]) filter[k] = String(Math.floor(new Date(filter[k]).getTime() / 1000));
    cms.reloadPart(nid, "list", { filter });
  };
  let timer;
  filterForm?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(reloadList, 250); });

  // forms (filter on Enter, tools) must never navigate
  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const tool = e.target.closest("[data-tool]");
    if (tool) {
      tool.style.cssText = "opacity:.5; pointer-events:none";
      cms.reloadNode(nid, { do: tool.dataset.tool, data: Object.fromEntries(new FormData(tool)) });
    } else if (e.target.closest("[data-filter]")) {
      reloadList();
    }
  });

  // optimize button (no form)
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-reload]");
    if (btn) { e.preventDefault(); btn.disabled = true; cms.reloadNode(nid, JSON.parse(btn.dataset.reload)); }
  });
});
