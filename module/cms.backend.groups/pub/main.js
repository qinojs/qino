import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.groups", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = apt.cms.node(nid);
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");

  el.addEventListener("click", (e) => {
    const del = e.target.closest(".-delete button");
    if (del) {
      const tr = del.closest("[itemid]");
      node.api.post({ delete: itemId(del) }).then((ok) => { if (ok) tr.remove(); });
      return;
    }
    const rm = e.target.closest(".-members .-remove");
    if (rm) {
      const tr = rm.closest("tr");
      node.api.post({ set_usr: itemId(rm), usr_id: rm.dataset.usr, add: 0 }).then((ok) => { if (ok) tr.remove(); });
    }
  });

  // save field on change (overview rows and detail share the [itemid] scope)
  el.addEventListener("change", (e) => {
    const field = e.target.closest("[name]");
    const id = field && itemId(field);
    if (!id) return;
    node.api.post({ save: id, name: field.name, value: field.value });
  });

  // detail: add member by email
  const addForm = el.querySelector("[data-add-member]");
  addForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ok = await node.api.post({ add_email: itemId(addForm), email: addForm.email.value });
    if (ok) cms.reloadNode(nid);
  });
});
