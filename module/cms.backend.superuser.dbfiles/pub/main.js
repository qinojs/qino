import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.dbfiles", (el) => {
  const nid = Number(cms.el.nid(el));

  // live search/order → reload only the list part
  const filterForm = el.querySelector("[data-filter]");
  const reloadList = () => cms.reloadPart(nid, "list", Object.fromEntries(new FormData(filterForm)));
  let timer;
  filterForm?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(reloadList, 300); });
  filterForm?.addEventListener("submit", (e) => e.preventDefault());

  el.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete]");
    if (del) {
      e.stopPropagation();
      await apt.cms.node(nid).html.post({ vars: { delete: del.dataset.delete } });
      del.closest("tr").remove();
      return;
    }
    // maintenance action → reload whole node, result shown inline
    const action = e.target.closest("[data-reload]");
    if (action) { action.disabled = true; cms.reloadNode(nid, JSON.parse(action.dataset.reload)); return; }

    if (e.target.closest("[data-copy-url]")) navigator.clipboard.writeText(el.querySelector("[data-url]").href);
  });

  // detail: save field on change
  el.addEventListener("change", (e) => {
    const set = e.target.closest("[data-set]");
    if (!set) return;
    const val = set.type === "checkbox" ? (set.checked ? 1 : 0) : set.value;
    apt.cms.node(nid).html.post({ vars: { [set.dataset.set]: val } });
  });
});
