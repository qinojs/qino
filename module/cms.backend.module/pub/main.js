cms.initNode("backend.module", (el) => {
  // client-side filter — all modules are already rendered, no round-trip needed
  const search = el.querySelector("[data-module-search]");
  search?.addEventListener("input", () => {
    const q = search.value.toLowerCase();
    // inline display beats u2-table's `display:table-row`, which would override [hidden]
    for (const tr of el.querySelectorAll("tbody tr")) tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
});
