import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.users", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = apt.cms.node(nid);
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");

  // overview: live search → reload list part
  const search = el.querySelector("#usrSearch");
  let timer;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => cms.reloadPart(nid, "list", { search: search.value }), 250);
  });

  el.addEventListener("click", (e) => {
    const del = e.target.closest(".-delete button");
    if (del) {
      const tr = del.closest("[itemid]");
      node.api.post({ delete: itemId(del) }).then((ok) => { if (ok) tr.remove(); });
      return;
    }
    const loginAs = e.target.closest(".-loginAs");
    if (loginAs) node.api.post({ login_as: itemId(loginAs) }).then((ok) => { if (ok) location.href = globalThis.qino?.appURL ?? "/"; });
  });

  // detail: save field on change / toggle group membership
  el.addEventListener("change", (e) => {
    const field = e.target.closest(".-detail [name]");
    if (field) {
      const value = field.type === "checkbox" ? (field.checked ? field.value : "0") : field.value;
      node.api.post({ save: itemId(field), name: field.name, value });
      return;
    }
    const grp = e.target.closest(".-set_grp input[type=checkbox]");
    if (grp) node.api.post({ set_grp: itemId(grp), grp_id: grp.value, add: grp.checked ? 1 : 0 });
  });
});
