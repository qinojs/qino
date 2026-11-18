import { initNode } from "@qino/m/cms/pub/js/cms.js";

initNode("backend.superuser.db", (el) => {
  el.querySelector("[data-table-search]")?.addEventListener("input", (e) => {
    const search = e.target.value.toLowerCase();
    el.querySelectorAll("[data-table-name]").forEach((row) => row.style.display = row.dataset.tableName.toLowerCase().includes(search) ? "" : "none");
  });
});
