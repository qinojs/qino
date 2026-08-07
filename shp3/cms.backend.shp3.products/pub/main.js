import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.shp3.products", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");
  const value = (root, name) => root.querySelector(`[name=${name}]`).value;

  el.addEventListener("change", (e) => {
    const field = e.target.closest("input.-f");
    if (field) {
      const checkbox = field.type === "checkbox";
      node.api.post({ save: itemId(field), field: field.dataset.field, value: checkbox ? field.checked : field.value })
        .then((r) => { if (r && !checkbox) field.value = r.value; });
      return;
    }
    const vat = e.target.closest("input.-vat");
    if (vat) node.api.post({ vat: itemId(vat), country: vat.dataset.country, rate: vat.value });
  });

  el.addEventListener("click", (e) => {
    // The "add VAT" row lives in a table, not in a form of its own.
    const add = e.target.closest("tr.-new button");
    if (add) {
      e.preventDefault();
      const row = add.closest("tr");
      node.api.post({ vat: itemId(row), country: value(row, "country"), rate: value(row, "rate") })
        .then((r) => { if (r) location.reload(); });
      return;
    }
    const del = e.target.closest(".-delete button");
    if (!del) return;
    const row = del.closest("tr");
    const vat = row.querySelector("input.-vat");
    // Clearing the rate drops the VAT row; a product takes its page with it.
    const done = vat
      ? node.api.post({ vat: itemId(vat), country: vat.dataset.country, rate: "" })
      : node.api.post({ delete: itemId(del) });
    done.then((r) => { if (r) row.remove(); });
  });

  el.addEventListener("submit", (e) => {
    const form = e.target.closest("form.-add");
    if (!form) return;
    e.preventDefault();
    if (!form.reportValidity()) return;
    // form.title would be the title attribute, not the field.
    node.api.post({ add: value(form, "title"), parent: value(form, "parent"), lang: cms.lang })
      .then((r) => { if (r) location.href = "?shp3_productId=" + r.id; });
  });
});
