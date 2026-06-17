cms.initNode("backend.module", (el) => {
  // client-side filter — all modules are already rendered, no round-trip needed
  const search = el.querySelector("[data-module-search]");
  search?.addEventListener("input", () => {
    const q = search.value.toLowerCase();
    for (const tr of el.querySelectorAll("tbody tr")) tr.hidden = !tr.textContent.toLowerCase().includes(q);
  });
});
