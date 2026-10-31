import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

cms.initNode("backend.cms.form", (el) => {
  const nid = Number(cms.el.nid(el));
  const search = el.querySelector("[data-search]");
  const spam = el.querySelector("[data-spam]");
  // the form comes from the url (?form=…); without, the server showed the first one
  const form = new URLSearchParams(location.search).get("form") ?? "";
  let sort = "created", dir = "desc", page = 0, timer;
  const active = () => form || el.querySelector("[aria-current]")?.getAttribute("href").replace("?form=", "");

  // reload only the table part (it keeps form, search, sort, page)
  const reloadList = (vars) => cms.reloadPart(nid, "list", { form, search: search.value, spam: spam.checked, sort, dir, page, ...vars });

  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { page = 0; reloadList({ page }); }, 250);
  });

  spam.addEventListener("change", () => { page = 0; reloadList({ page }); });

  // An entry is corrected in a dialog: its fields, labeled by the table's head; uploads are not values.
  const edit = async (row) => {
    const cells = [...row.querySelectorAll("[data-field]")];
    const label = (name) => el.querySelector(`th[data-sort="${CSS.escape(name)}"]`)?.textContent.replace(/[▲▼]/g, "").trim();
    const { form: dialog } = await import("@qino/u2/js/dialog/dialog.js");
    const title = await t`Edit`;
    const data = await dialog({
      body: "<b></b>",
      init(d) {
        const head = d.querySelector("b");
        head.textContent = title;
        for (const cell of cells.toReversed()) {
          const value = cell.textContent;
          const input = document.createElement(value.includes("\n") || value.length > 60 ? "textarea" : "input");
          Object.assign(input, { name: cell.dataset.field, value });
          if (input.localName === "textarea") input.rows = Math.min(12, value.split("\n").length + 2);
          input.style.cssText = "display:block;width:min(40rem,80vw)";
          const field = document.createElement("label");
          field.append(label(cell.dataset.field) ?? cell.dataset.field, input);
          head.after(field);
        }
      },
    });
    if (data) reloadList({ save: { id: row.dataset.entry, data } });
  };

  el.addEventListener("click", async (e) => {
    const th = e.target.closest("[data-sort]");
    if (th) { sort = th.dataset.sort; dir = th.dataset.dir; page = 0; return reloadList({ page }); }

    const pager = e.target.closest("[data-page]");
    if (pager) { page = Number(pager.dataset.page); return reloadList({ page }); }

    const ed = e.target.closest("[data-edit]");
    if (ed) return edit(ed.closest("[data-entry]"));

    const del = e.target.closest("[data-delete]");
    if (del) { del.disabled = true; return reloadList({ delete: del.dataset.delete }); }

    const exp = e.target.closest("[data-export]");
    if (exp) {
      const res = await api.cms.node(nid).api.post({ export: active(), search: search.value, spam: spam.checked, format: exp.dataset.export });
      if (!res?.data) return;
      // The file is made here rather than fetched: the api already carries the rights.
      const url = URL.createObjectURL(new Blob([Uint8Array.fromBase64(res.data)], { type: res.type }));
      Object.assign(document.createElement("a"), { href: url, download: res.name }).click();
      URL.revokeObjectURL(url);
    }
  });
});
