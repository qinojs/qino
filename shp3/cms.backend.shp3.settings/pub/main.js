import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.shp3.settings", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = apt.cms.node(nid);
  const id = (target) => target.closest("[itemid]").getAttribute("itemid");
  const value = (input) => input.type === "checkbox" || input.type === "radio" ? input.checked : input.value;

  el.addEventListener("change", (e) => {
    const set = e.target.closest(".-set");
    if (set) return node.api.post({ setting: set.dataset.setting, value: value(set) });

    const cur = e.target.closest("input.-cur");
    if (cur) {
      // Switching the main currency rescales every factor — the numbers on screen are stale then.
      node.api.post({ currency: id(cur), field: cur.dataset.field, value: value(cur) })
        .then(() => { if (cur.dataset.field === "main") cms.reloadNode(nid); });
      return;
    }

    const country = e.target.closest("input.-country");
    if (country) {
      node.api.post({ country: id(country), field: country.dataset.field, value: value(country) });
      if (country.dataset.field === "shp3_enabled") country.closest("tr").classList.toggle("-on", country.checked);
    }
  });

  // The countries it sells to are on top; the rest is what the search is for.
  const search = el.querySelector(".-search");
  search?.addEventListener("input", () => {
    const term = search.value.trim().toLowerCase();
    for (const tr of search.closest(".u2-card").querySelectorAll("tbody tr")) {
      tr.hidden = !!term && !tr.textContent.toLowerCase().includes(term);
    }
  });
});
