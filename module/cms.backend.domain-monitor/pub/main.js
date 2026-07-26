import { apt, ctx } from "../../core/pub/js/qino.js";

cms.initNode("backend.domain-monitor", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = apt.cms.node(nid);
  const table = el.querySelector("table.-domains");
  const tbody = el.querySelector("tbody[data-monitor-list]");
  const search = el.querySelector("[data-monitor-search]");
  const filter = el.querySelector("[data-monitor-filter]");
  const count = el.querySelector("[data-monitor-count]");

  const bulk = el.querySelector("[data-bulk]");
  const bulkCount = el.querySelector("[data-bulk-count]");
  const bulkDelete = el.querySelector("[data-bulk-delete]");
  const selectAll = el.querySelector("[data-select-all]");

  const rows = () => [...(tbody?.querySelectorAll("tr[data-domain]") ?? [])];
  const visible = () => rows().filter((tr) => tr.style.display !== "none");
  const selected = () => rows().filter((tr) => tr.querySelector("[data-select]")?.checked);

  const replaceRows = (response) => {
    let replaced = false;
    for (const [domain, html] of Object.entries(response?.rows ?? {})) {
      const tr = tbody?.querySelector(`tr[data-domain="${domain}"]`);
      if (!tr) continue;
      const wasSelected = tr.querySelector("[data-select]")?.checked;
      tr.outerHTML = html;
      // the replacement is freshly rendered, so it comes back unchecked
      if (wasSelected) tbody.querySelector(`tr[data-domain="${domain}"] [data-select]`).checked = true;
      replaced = true;
    }
    return replaced;
  };

  const showSelection = () => {
    if (!bulk) return;
    const count = selected().length;
    bulk.hidden = !count;
    bulkCount.textContent = count;
    // u2 asks before the click reaches the handler, so the question has to know the count
    bulkDelete?.setAttribute("u2-confirm", `Delete ${count} selected domain${count === 1 ? "" : "s"}?`);
    if (selectAll) selectAll.checked = count > 0 && count === visible().length;
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
    let removing = null; // rows to drop once the server confirms the delete
    if (a === "check") vars.check = btn.dataset.domain;
    else if (a === "checkSelected") {
      const domains = selected().map((tr) => tr.dataset.domain);
      if (!domains.length) return;
      vars.check = domains.join(",");
    } else if (a === "delete" || a === "deleteSelected") {
      removing = a === "delete" ? [btn.closest("tr")] : selected();
      if (!removing.length) return;
      vars.delete = removing.map((tr) => tr.dataset.domain).join(",");
    } else if (a === "expect") {
      const { prompt } = await import("@qino/u2/js/dialog/dialog.js");
      const value = await prompt("Text that must appear in the body (empty = no content check)", btn.dataset.expect || "");
      if (value == null) return;
      Object.assign(vars, { expect: btn.dataset.domain, value });
    } else return;

    btn.disabled = true;
    try {
      const response = await node.api.post(vars);
      if (removing && response?.done) {
        for (const tr of removing) tr.remove();
        count.textContent = rows().length;
        showSelection();
        return;
      }
      if (!replaceRows(response) && !tbody) location.reload();
      apply();
    } finally {
      btn.disabled = false;
    }
  });

  const setFrequency = async (control, domains, value) => {
    control.disabled = true;
    try {
      const response = await node.api.post({ frequency: domains.join(","), value });
      if (!replaceRows(response) && !tbody) location.reload();
      apply();
      showSelection();
    } finally {
      control.disabled = false;
    }
  };

  // Column groups. The class on the table does the hiding, so this only has to remember the choice
  // for the user — the server renders the same class set on the next load.
  const setCols = (group, show) => {
    table?.classList.toggle("-no-" + group, !show);
    const hidden = [...el.querySelectorAll("[data-col]")].filter((box) => !box.checked).map((box) => box.dataset.col);
    ctx.settings["cms.backend.domain-monitor"].cols(hidden.join(","));
  };

  el.addEventListener("change", (event) => {
    const target = event.target;
    const col = target.closest("[data-col]");
    if (col) return setCols(col.dataset.col, col.checked);
    if (target.closest("[data-select]")) return showSelection();
    if (target.closest("[data-select-all]")) {
      for (const tr of visible()) tr.querySelector("[data-select]").checked = target.checked;
      return showSelection();
    }
    if (target.closest("[data-bulk-frequency]")) {
      const domains = selected().map((tr) => tr.dataset.domain);
      if (!target.value || !domains.length) return;
      const value = target.value;
      target.value = ""; // back to the "set interval…" placeholder
      return setFrequency(target, domains, value);
    }
    const select = target.closest("[data-frequency]");
    if (select) return setFrequency(select, [select.dataset.domain], select.value);
  });

  // client-side search + severity filter (sorting is handled by <u2-table>)
  const apply = () => {
    if (!tbody || !search || !filter) return;
    const q = (search.value || "").toLowerCase();
    const f = filter.value; // "", "ok", "problem"
    for (const tr of tbody.querySelectorAll("tr")) {
      const level = Number(tr.querySelector("[data-value]")?.dataset.value); // status severity, 0 = green … 4 = red
      const okFilter = !f || (f === "ok" ? level <= 1 : level >= 3);
      const okSearch = tr.textContent.toLowerCase().includes(q);
      const show = okFilter && okSearch;
      tr.style.display = show ? "" : "none";
      // a row that drops out of sight drops its tick, so the count and every bulk
      // action only ever mean the rows you can actually see
      const box = tr.querySelector("[data-select]");
      if (box && !show) box.checked = false;
    }
    showSelection();
  };
  search?.addEventListener("input", apply);
  filter?.addEventListener("change", apply);
});
