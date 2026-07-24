import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.monitor", (el) => {
  const nid = Number(cms.el.nid(el));
  const tbody = el.querySelector("tbody");
  const search = el.querySelector("[data-monitor-search]");
  const filter = el.querySelector("[data-monitor-filter]");
  const count = el.querySelector("[data-monitor-count]");

  // background mutations. delete/check update just their row (keeps search/sort state);
  // add/checkAll re-render the whole node (a deliberate refresh of the list).
  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.preventDefault();
    const a = btn.dataset.action;
    if (a === "delete" || a === "check") {
      btn.disabled = true;
      const r = await apt.cms.node(nid).api.post({ [a]: btn.dataset.id });
      const tr = btn.closest("tr");
      if (a === "delete" && r?.done) { tr.remove(); count.textContent = tbody.querySelectorAll("tr").length; }
      else if (a === "check" && r?.row) { tr.outerHTML = r.row; apply(); }
      else btn.disabled = false;
      return;
    }
    const vars = a === "add" ? { add: "1", urls: el.querySelector("[name=urls]").value } : { checkAll: "1" };
    if (a === "add" && !vars.urls.trim()) return;
    btn.disabled = true;
    cms.reloadNode(nid, vars);
  });

  // client-side search + online/offline filter (sorting is handled by <u2-table>)
  const apply = () => {
    const q = (search.value || "").toLowerCase();
    const f = filter.value; // "", "up", "down"
    for (const tr of tbody.querySelectorAll("tr")) {
      const on = tr.firstElementChild?.dataset.value; // "2"=up, "1"=down, "0"=unknown
      const okFilter = !f || (f === "up" ? on === "2" : on === "1");
      const okSearch = tr.textContent.toLowerCase().includes(q);
      tr.style.display = okFilter && okSearch ? "" : "none";
    }
  };
  search?.addEventListener("input", apply);
  filter?.addEventListener("change", apply);
});
