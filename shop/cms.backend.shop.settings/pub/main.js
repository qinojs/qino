// The methods a shop offers: the rows that are on, in their order, are the setting.
import { api } from "@qino/pub/api.js";

// dynamic: the drag attributes pull a cdn dependency that `deno check --all` cannot follow
import("@qino/u2/attr/dropzone/dropzone.js");
import("@qino/u2/attr/draghandle/draghandle.js");

const save = (tbody) => api.cms.node(Number(cms.el.nid(tbody))).api.post({
  setting: tbody.dataset.methods,
  value: [...tbody.querySelectorAll("tr:has(:checked)")].map((tr) => tr.dataset.method).join(", "),
});

document.addEventListener("change", (e) => {
  const tbody = e.target.closest?.("[data-methods]");
  if (tbody && !e.target.name) save(tbody); // a named field is a label, rows.js saves it
});
document.addEventListener("u2-dropzone-drop", (e) => {
  const tbody = e.detail?.add && e.target.closest?.("[data-methods]"); // the same zone fires remove+add
  if (tbody) requestAnimationFrame(() => save(tbody));
});
