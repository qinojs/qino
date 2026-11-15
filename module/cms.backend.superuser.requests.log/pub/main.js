cms.initNode("backend.superuser.requests.log", (el) => {
  const nid = Number(cms.el.nid(el));

  // live filter → reload only the list part
  const filterForm = el.querySelector("[data-filter]");
  const reloadList = () => {
    const filter = Object.fromEntries(new FormData(filterForm));
    // datetime-local is in the browser's TZ → convert to UTC unix seconds here
    if (filter.to) filter.to = String(Math.floor(new Date(filter.to).getTime() / 1000));
    cms.reloadPart(nid, "list", { filter });
  };
  // "to" can't lie in the future: cap it at now (local time, as datetime-local expects)
  const to = filterForm?.elements.to;
  const capTo = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); to.max = d.toISOString().slice(0, 16); };
  if (to) { capTo(); to.addEventListener("focus", capTo); }
  let timer;
  filterForm?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(reloadList, 250); });

  // forms (filter on Enter, tools) must never navigate
  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const tool = e.target.closest("[data-tool]");
    if (tool) {
      tool.style.cssText = "opacity:.5; pointer-events:none";
      cms.reloadNode(nid, { do: tool.dataset.tool, data: Object.fromEntries(new FormData(tool)) });
    } else if (e.target.closest("[data-filter]")) reloadList();
  });

  // optimize button (no form)
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-reload]");
    if (btn) { e.preventDefault(); btn.disabled = true; cms.reloadNode(nid, JSON.parse(btn.dataset.reload)); }
  });
});
