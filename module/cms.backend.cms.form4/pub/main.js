import { api } from "@qino/pub/api.js";

cms.initNode("backend.cms.form4", (el) => {
  const nid = Number(cms.el.nid(el));
  const search = el.querySelector("[data-search]");
  let form = "", sort = "created", dir = "desc", page = 0, timer;
  // Without a pick the server showed the first form — the export has to mean the same one.
  const active = () => el.querySelector("tr.-active [data-form]")?.dataset.form;

  // the table keeps its own state (form, search, sort, page) and its writes — reload it, not the whole node
  const reloadList = (vars) => cms.reloadPart(nid, "list", { form, search: search.value, sort, dir, page, ...vars });

  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { page = 0; reloadList({ page }); }, 250);
  });

  // A cell saves when it loses focus — no save button per row, as in the redirects list.
  el.addEventListener("change", (e) => {
    const input = e.target.closest("[data-field]");
    if (!input) return;
    reloadList({ save: { id: input.closest("[data-entry]").dataset.entry, field: input.dataset.field, value: input.value } });
  });

  el.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-form]");
    if (pick) { form = pick.dataset.form; page = 0; sort = "created"; dir = "desc"; return cms.reloadNode(nid, { form, sort, dir, page }); }

    const th = e.target.closest("[data-sort]");
    if (th) { sort = th.dataset.sort; dir = th.dataset.dir; page = 0; return reloadList({ page }); }

    const pager = e.target.closest("[data-page]");
    if (pager) { page = Number(pager.dataset.page); return reloadList({ page }); }

    const del = e.target.closest("[data-delete]");
    if (del) { del.disabled = true; return reloadList({ delete: del.dataset.delete }); }

    const exp = e.target.closest("[data-export]");
    if (exp) {
      const res = await api.cms.node(nid).api.post({ export: form || active(), search: search.value });
      if (!res?.csv) return;
      // The file is made here rather than fetched: the api already carries the rights.
      const url = URL.createObjectURL(new Blob([res.csv], { type: "text/csv;charset=utf-8" }));
      Object.assign(document.createElement("a"), { href: url, download: res.name }).click();
      URL.revokeObjectURL(url);
    }
  });
});
