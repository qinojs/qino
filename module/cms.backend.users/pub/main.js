import { api } from "@qino/pub/qino.js";

cms.initNode("backend.users", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");

  // overview: live search / group filter → reload list part
  const search = el.querySelector("#usrSearch");
  const grpSel = el.querySelector("#usrGrp");
  const reloadList = () => {
    const url = new URL(location);
    grpSel?.value ? url.searchParams.set("grp_id", grpSel.value) : url.searchParams.delete("grp_id");
    history.replaceState(null, "", url);
    cms.reloadPart(nid, "list", { search: search?.value ?? "", grp_id: grpSel?.value ?? "" });
  };
  let timer;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(reloadList, 250);
  });
  grpSel?.addEventListener("change", reloadList);

  // detail: contacts — the address is the identity, so channel and address travel together
  const contactVars = (button, key) => {
    const [type, ...rest] = button.dataset[key].split(":");
    return { type, address: rest.join(":") };
  };
  // the user travels with the reload too — the detail root carries the itemid, so it never comes from a lookup
  const contactResult = (id) => (response) => {
    if (response?.ok) return cms.reloadPart(nid, "contacts", { id });
    if (response?.message) return import("@qino/u2/js/dialog/dialog.js").then((d) => d.alert(response.message));
  };

  el.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-contact-add]");
    if (!form) return;
    e.preventDefault();
    const id = itemId(form);
    node.api.post({
      contact_add: id,
      type: form.elements.type.value,
      address: form.elements.address.value.trim(),
    }).then(contactResult(id));
  });

  el.addEventListener("click", (e) => {
    const contactDel = e.target.closest("[data-contact-delete]");
    if (contactDel) {
      node.api.post({ contact_delete: itemId(contactDel), ...contactVars(contactDel, "contactDelete") }).then(contactResult(itemId(contactDel)));
      return;
    }
    const contactMain = e.target.closest("[data-main]");
    if (contactMain) {
      node.api.post({ contact_main: itemId(contactMain), ...contactVars(contactMain, "main") }).then(contactResult(itemId(contactMain)));
      return;
    }
    const del = e.target.closest(".-delete button");
    if (del) {
      const tr = del.closest("[itemid]");
      node.api.post({ delete: itemId(del) }).then((ok) => { if (ok) tr.remove(); });
      return;
    }
    const loginAs = e.target.closest(".-loginAs");
    if (loginAs) node.api.post({ login_as: itemId(loginAs) }).then((ok) => { if (ok) location.href = globalThis.qino?.appUrl ?? "/"; });
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
