import { ctx } from "@qino/pub/qino.js";

cms.initNode("backend.cms.module", (el) => {
  const nid = Number(cms.el.nid(el));

  // overview: search + type filter, client-side — every module is already rendered
  // the buttons act on their own; nothing here is meant to submit
  el.querySelector("[data-replace-form]")?.addEventListener("submit", (e) => e.preventDefault());

  const search = el.querySelector("[data-search]");
  const typeFilter = el.querySelector("[data-type-filter]");
  if (typeFilter) {
    const filter = () => {
      const q = search.value.toLowerCase(), type = typeFilter.value;
      for (const tr of el.querySelectorAll("tbody tr[data-type]")) {
        const show = (!type || tr.dataset.type === type) && tr.textContent.toLowerCase().includes(q);
        tr.style.display = show ? "" : "none";
      }
    };
    search.addEventListener("input", filter);
    typeFilter.addEventListener("change", () => {
      filter();
      ctx.settings["cms.backend.cms.module"].filter.type(typeFilter.value); // remembered for the session
    });
    if (typeFilter.value) filter(); // restored selection
  }

  // detail: delegated, so u2-table reordering and node reloads can't stale the handlers
  el.addEventListener("change", (e) => {
    if (!e.target.matches("[data-check-all]")) return;
    for (const box of el.querySelectorAll("[data-check]")) box.checked = e.target.checked;
  });

  el.addEventListener("click", (e) => {
    if (!e.target.closest("[data-replace]")) return;
    const ids = [...el.querySelectorAll("[data-check]:checked")].map((b) => b.value);
    const target = el.querySelector("[data-target]").value;
    if (!ids.length || !target) return;
    cms.reloadNode(nid, { mod: el.dataset.mod, replace: target, ids: ids.join(",") });
  });
});
