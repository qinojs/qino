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
      // Taking a currency on brings its own fields with it, a new main rescales every factor.
      const reload = cur.dataset.field === "active" || cur.dataset.field === "main";
      node.api.post({ currency: id(cur), field: cur.dataset.field, value: value(cur) })
        .then(() => { if (reload) cms.reloadNode(nid); });
      return;
    }

    const country = e.target.closest("input.-country");
    if (country) {
      node.api.post({ country: id(country), field: country.dataset.field, value: value(country) });
      if (country.dataset.field === "shp3_enabled") country.closest("tr").classList.toggle("-on", country.checked);
    }
  });

  // What the shop uses is on top; the rest of the list is what the search is for. Delegated, so
  // it survives a reload of the node.
  el.addEventListener("input", (e) => {
    const search = e.target.closest(".-search");
    if (!search) return;
    const term = search.value.trim().toLowerCase();
    for (const tr of search.closest(".u2-card").querySelectorAll("tbody tr")) {
      tr.style.display = !term || tr.textContent.toLowerCase().includes(term) ? "" : "none";
    }
  });
});
