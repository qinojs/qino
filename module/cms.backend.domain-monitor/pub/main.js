import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.domain-monitor", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = apt.cms.node(nid);
  const tbody = el.querySelector("tbody[data-monitor-list]");
  const search = el.querySelector("[data-monitor-search]");
  const filter = el.querySelector("[data-monitor-filter]");
  const count = el.querySelector("[data-monitor-count]");

  const rows = () => [...(tbody?.querySelectorAll("tr[data-domain]") ?? [])];

  const replaceRows = (response) => {
    let replaced = false;
    for (const [domain, html] of Object.entries(response?.rows ?? {})) {
      const tr = tbody?.querySelector(`tr[data-domain="${domain}"]`);
      if (!tr) continue;
      tr.outerHTML = html;
      replaced = true;
    }
    return replaced;
  };

  // background mutations. every check returns its rows and swaps them in place, so search,
  // filter and sort survive; only add re-renders the whole node (new rows have to appear).
  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.preventDefault();
    const a = btn.dataset.action;

    if (a === "add") {
      const domains = el.querySelector("[name=domains]").value;
      if (!domains.trim()) return;
      btn.disabled = true;
      cms.reloadNode(nid, { add: "1", domains });
      return;
    }

    const vars = {};
    if (a === "delete" || a === "check") vars[a] = btn.dataset.domain;
    else if (a === "checkAll") vars.check = "all";
    else if (a === "checkProblems") vars.check = "problem";
    else if (a === "checkVisible") {
      const domains = rows().filter((tr) => tr.style.display !== "none").map((tr) => tr.dataset.domain);
      if (!domains.length) return;
      vars.check = domains.join(",");
    } else if (a === "expect") {
      const { prompt } = await import("@qino/u2/js/dialog/dialog.js");
      const value = await prompt("Text that must appear in the body (empty = no content check)", btn.dataset.expect || "");
      if (value == null) return;
      Object.assign(vars, { expect: btn.dataset.domain, value });
    } else return;

    btn.disabled = true;
    try {
      const response = await node.api.post(vars);
      if (a === "delete" && response?.done) {
        btn.closest("tr").remove();
        count.textContent = rows().length;
        return;
      }
      if (!replaceRows(response) && !tbody) location.reload();
      apply();
    } finally {
      btn.disabled = false;
    }
  });

  el.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-frequency]");
    if (!select) return;
    select.disabled = true;
    try {
      const response = await node.api.post({ frequency: select.dataset.domain, value: select.value });
      if (!replaceRows(response) && !tbody) location.reload();
      apply();
    } finally {
      select.disabled = false;
    }
  });

  // client-side search + severity filter (sorting is handled by <u2-table>)
  const apply = () => {
    if (!tbody || !search || !filter) return;
    const q = (search.value || "").toLowerCase();
    const f = filter.value; // "", "ok", "problem"
    for (const tr of tbody.querySelectorAll("tr")) {
      const level = Number(tr.firstElementChild?.dataset.value); // status severity, 0 = green … 4 = red
      const okFilter = !f || (f === "ok" ? level <= 1 : level >= 3);
      const okSearch = tr.textContent.toLowerCase().includes(q);
      tr.style.display = okFilter && okSearch ? "" : "none";
    }
  };
  search?.addEventListener("input", apply);
  filter?.addEventListener("change", apply);
});
