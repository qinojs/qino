import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.system.health", (el) => {
  const { node, refresh, alert } = nodePanel(el, ["table"]);

  const loadRow = async (row) => {
    row.innerHTML = await node.html.part("check").post({ vars: { type: row.dataset.type, item: row.dataset.item } });
    row.classList.toggle("-passed", !!row.querySelector(".u2-badge.-passed"));
  };

  // one after another: every check re-collects the registry, so parallel runs only pile up load
  const loadAll = async () => {
    let sum = 0;
    for (const row of el.querySelectorAll("tr[data-item]")) {
      await loadRow(row);
      sum += parseFloat(row.querySelector(".-time")?.textContent) || 0;
      el.querySelector(".-total").textContent = Math.round(sum) + " ms";
    }
  };
  loadAll();

  el.addEventListener("change", (e) => {
    if (e.target.closest("input[data-all]")) {
      el.querySelector("[cms-part=table]").classList.toggle("-only-issues", !e.target.checked);
    }
  });

  el.addEventListener("click", async (e) => {
    if (e.target.closest("button[data-refresh]")) {
      await refresh().catch((err) => alert(err?.message || String(err)));
      loadAll();
      return;
    }

    const btn = e.target.closest("button[data-solution]");
    if (!btn) return;
    e.preventDefault();
    const row      = btn.closest("tr[data-item]");
    const solution = btn.getAttribute("data-solution");
    const form     = btn.closest("form");
    const formData = form ? Object.fromEntries(new FormData(form)) : {};

    btn.disabled = true;
    const result = await node.api.post({
      solve_health_item: { type: row.dataset.type, item: row.dataset.item, solution, formData },
    }).catch((err) => ({ response: err?.message || String(err) }));

    if (result?.response) await alert(result.response);
    result?.done ? await loadRow(row) : (btn.disabled = false);
  });
});
