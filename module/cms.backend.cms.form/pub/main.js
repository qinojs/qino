import { api } from "@qino/pub/api.js";

cms.initNode("backend.cms.form", (el) => {
  const nid = Number(cms.el.nid(el));
  const search = el.querySelector("[data-search]");
  // the form comes from the url (?form=…); without, the server showed the first one
  const form = new URLSearchParams(location.search).get("form") ?? "";
  let sort = "created", dir = "desc", page = 0, timer;
  const active = () => form || el.querySelector("tr.-active [href]")?.getAttribute("href").replace("?form=", "");

  // reload only the table part (it keeps form, search, sort, page)
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
    const th = e.target.closest("[data-sort]");
    if (th) { sort = th.dataset.sort; dir = th.dataset.dir; page = 0; return reloadList({ page }); }

    const pager = e.target.closest("[data-page]");
    if (pager) { page = Number(pager.dataset.page); return reloadList({ page }); }

    const del = e.target.closest("[data-delete]");
    if (del) { del.disabled = true; return reloadList({ delete: del.dataset.delete }); }

    const exp = e.target.closest("[data-export]");
    if (exp) {
      const res = await api.cms.node(nid).api.post({ export: active(), search: search.value, format: exp.dataset.export });
      if (!res?.data) return;
      // The file is made here rather than fetched: the api already carries the rights.
      const url = URL.createObjectURL(new Blob([Uint8Array.fromBase64(res.data)], { type: res.type }));
      Object.assign(document.createElement("a"), { href: url, download: res.name }).click();
      URL.revokeObjectURL(url);
    }
  });
});
